import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { kaiStudioDataDirectory } from "@/lib/memory/config";
import { cosine, type ScopedEmbeddingProvider } from "@/lib/retrieval/embedding-provider";
import { generationId, type IndexGeneration } from "@/lib/retrieval/identity";

const ignoredDirectories = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", "vendor", ".cache"]);
const ignoredExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".gz", ".dmg", ".app", ".min.js", ".map"]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml", ".css", ".html", ".sh", ".py", ".go", ".rs", ".java"]);

export type CodingChunk = {
  id: string;
  repositoryId: string;
  worktreeId: string;
  revision: string;
  path: string;
  language: string;
  symbolName: string | null;
  symbolType: string | null;
  parentSymbol: string | null;
  startLine: number;
  endLine: number;
  imports: string[];
  exports: string[];
  classification: "test" | "production" | "documentation" | "configuration";
  generated: boolean;
  contentHash: string;
  content: string;
  vector: number[];
  indexedAt: string;
};

export type CodingRetrievalCandidate = CodingChunk & {
  lexicalScore: number;
  vectorScore: number;
  fusedScore: number;
  metadataBoost: number;
  relationship: string | null;
  current: boolean;
  exactContent?: string;
};

export type CodingRetrievalReport = {
  repositoryId: string;
  query: string;
  generation: IndexGeneration | null;
  vectorAvailable: boolean;
  lexicalCandidates: CodingRetrievalCandidate[];
  vectorCandidates: CodingRetrievalCandidate[];
  selected: CodingRetrievalCandidate[];
  omitted: number;
  contextCharacters: number;
  diagnostics: { filesDiscovered: number; filesSkipped: number; chunksProduced: number; chunksEmbedded: number; errors: string[] };
};

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function tokenize(value: string) { return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_./:-]+/gu) ?? [])].filter((word) => word.length > 1); }
function languageFor(file: string) { return path.extname(file).slice(1) || "text"; }
function classificationFor(file: string): CodingChunk["classification"] {
  if (/\.(test|spec)\.[^.]+$|(^|\/)(__tests__|tests?)(\/|$)/.test(file)) return "test";
  if (/\.md$/i.test(file)) return "documentation";
  if (/(^|\/)(package\.json|tsconfig.*\.json|next\.config|\.eslintrc|.*\.(ya?ml|json))$/i.test(file)) return "configuration";
  return "production";
}
function isGenerated(content: string, file: string) { return /generated|do not edit/i.test(content.slice(0, 500)) || /(^|\/)(generated|fixtures\/generated)(\/|$)/.test(file); }
function symbolStart(line: string) {
  const match = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/) || line.match(/^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[{=:]/);
  if (!match) return null;
  const kind = /\bclass\b/.test(line) ? "class" : /\b(interface|type)\b/.test(line) ? "type" : /\bfunction\b/.test(line) ? "function" : "declaration";
  return { name: match[1], kind };
}

export function chunkCodeFile(input: { repositoryId: string; worktreeId: string; revision: string; relativePath: string; content: string; indexedAt?: string }): CodingChunk[] {
  const lines = input.content.split("\n");
  const starts = lines.map((line, index) => ({ index, symbol: symbolStart(line) })).filter((item): item is { index: number; symbol: { name: string; kind: string } } => Boolean(item.symbol));
  const boundaries = starts.length ? starts : [{ index: 0, symbol: { name: "(file)", kind: "file" } }];
  const chunks: CodingChunk[] = [];
  for (let index = 0; index < boundaries.length; index += 1) {
    const start = boundaries[index].index;
    const end = Math.min(lines.length, (boundaries[index + 1]?.index ?? lines.length));
    // Keep declarations together, subdividing only genuinely large symbols.
    for (let offset = start; offset < end; offset += 220) {
      const chunkEnd = Math.min(end, offset + 220);
      const content = lines.slice(offset, chunkEnd).join("\n");
      const imports = content.match(/(?:import|require)\s*\(?["']([^"']+)/g)?.map((item) => item.replace(/^.*?["']/, "")) ?? [];
      const exports = content.match(/export\s+(?:default\s+)?(?:function|class|const|type|interface)\s+([A-Za-z_$][\w$]*)/g)?.map((item) => item.split(/\s+/).at(-1) ?? "") ?? [];
      const relativePath = input.relativePath.replaceAll(path.sep, "/");
      chunks.push({
        id: hash(`${input.repositoryId}:${input.worktreeId}:${input.revision}:${relativePath}:${offset + 1}:${content}`),
        repositoryId: input.repositoryId,
        worktreeId: input.worktreeId,
        revision: input.revision,
        path: relativePath,
        language: languageFor(relativePath),
        symbolName: boundaries[index].symbol.name === "(file)" ? null : boundaries[index].symbol.name,
        symbolType: boundaries[index].symbol.kind,
        parentSymbol: null,
        startLine: offset + 1,
        endLine: chunkEnd,
        imports,
        exports,
        classification: classificationFor(relativePath),
        generated: isGenerated(input.content, relativePath),
        contentHash: hash(content),
        content,
        vector: [],
        indexedAt: input.indexedAt ?? new Date().toISOString(),
      });
    }
  }
  return chunks;
}

async function collectFiles(root: string, relative = "", output: string[] = [], ignored: string[] = []) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) { ignored.push(path.join(relative, entry.name)); continue; }
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) { ignored.push(child); continue; }
      await collectFiles(root, child, output, ignored);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!entry.isFile() || ignoredExtensions.has(ext) || !textExtensions.has(ext)) { ignored.push(child); continue; }
    output.push(child);
  }
  return { files: output, ignored };
}

export class CodingHybridIndex {
  private database: DatabaseSync | null = null;
  private readonly databaseFile: string;
  private readonly repositoryRoot: string;
  private readonly repositoryId: string;
  private readonly embedding: ScopedEmbeddingProvider;
  constructor(repositoryRoot: string, repositoryId: string, embedding: ScopedEmbeddingProvider) {
    this.repositoryRoot = repositoryRoot;
    this.repositoryId = repositoryId;
    this.embedding = embedding;
    this.databaseFile = path.join(kaiStudioDataDirectory, "coding-indexes", `${hash(repositoryId).slice(0, 20)}.sqlite`);
  }
  async initialize() {
    if (this.database) return;
    await mkdir(path.dirname(this.databaseFile), { recursive: true });
    this.database = new DatabaseSync(this.databaseFile);
    this.database.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS coding_generations (generation_id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS coding_chunks (generation_id TEXT NOT NULL, id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL, content TEXT NOT NULL, vector_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS coding_chunks_generation ON coding_chunks(generation_id);
    `);
  }
  async sync(options: { revision?: string; worktreeId?: string; signal?: AbortSignal } = {}) {
    await this.initialize();
    const discovered = await collectFiles(this.repositoryRoot);
    const revision = options.revision ?? "workspace";
    const worktreeId = options.worktreeId ?? "default";
    const corpusVersion = hash((await Promise.all(discovered.files.map(async (file) => `${file}:${hash(await readFile(path.join(this.repositoryRoot, file), "utf8"))}`))).join("\n"));
    const identity = this.embedding.identity;
    const nextGeneration: IndexGeneration = { ...identity, generationId: generationId(identity, corpusVersion), corpusVersion, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "staging" };
    const current = this.activeGeneration();
    if (current?.generationId === nextGeneration.generationId) return { generation: current, filesDiscovered: discovered.files.length, filesSkipped: discovered.files.length, chunksProduced: 0, chunksEmbedded: 0, errors: [] as string[] };
    const db = this.db();
    const errors: string[] = [];
    let chunksProduced = 0;
    let chunksEmbedded = 0;
    db.prepare("INSERT OR REPLACE INTO coding_generations (generation_id, metadata_json, status, created_at, updated_at) VALUES (?, ?, 'staging', ?, ?)").run(nextGeneration.generationId, JSON.stringify(nextGeneration), nextGeneration.createdAt, nextGeneration.updatedAt);
    try {
      for (const relativePath of discovered.files) {
        if (options.signal?.aborted) throw new Error("Indexing cancelled.");
        const absolute = path.join(this.repositoryRoot, relativePath);
        const info = await stat(absolute);
        if (info.size > 500_000) continue;
        const content = await readFile(absolute, "utf8");
        const chunks = chunkCodeFile({ repositoryId: this.repositoryId, worktreeId, revision, relativePath, content });
        chunksProduced += chunks.length;
        for (const chunk of chunks) {
          if (chunk.generated) continue;
          const vector = this.embedding.available ? this.embedding.embed(chunk.content) : [];
          chunksEmbedded += vector.length ? 1 : 0;
          db.prepare("INSERT OR REPLACE INTO coding_chunks (generation_id, id, metadata_json, content, vector_json) VALUES (?, ?, ?, ?, ?)").run(nextGeneration.generationId, chunk.id, JSON.stringify({ ...chunk, content: undefined, vector: undefined }), chunk.content, JSON.stringify(vector));
        }
      }
      db.prepare("UPDATE coding_generations SET status = 'legacy', updated_at = ? WHERE status = 'active'").run(new Date().toISOString());
      nextGeneration.status = "active";
      nextGeneration.updatedAt = new Date().toISOString();
      db.prepare("UPDATE coding_generations SET metadata_json = ?, status = 'active', updated_at = ? WHERE generation_id = ?").run(JSON.stringify(nextGeneration), nextGeneration.updatedAt, nextGeneration.generationId);
      return { generation: nextGeneration, filesDiscovered: discovered.files.length, filesSkipped: discovered.ignored.length, chunksProduced, chunksEmbedded, errors };
    } catch (error) {
      db.prepare("UPDATE coding_generations SET status = 'failed', updated_at = ? WHERE generation_id = ?").run(new Date().toISOString(), nextGeneration.generationId);
      errors.push(error instanceof Error ? error.message : "Indexing failed.");
      return { generation: current, filesDiscovered: discovered.files.length, filesSkipped: discovered.ignored.length, chunksProduced, chunksEmbedded, errors };
    }
  }
  activeGeneration(): IndexGeneration | null {
    const row = this.db().prepare("SELECT metadata_json FROM coding_generations WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1").get() as { metadata_json?: string } | undefined;
    return row?.metadata_json ? JSON.parse(row.metadata_json) as IndexGeneration : null;
  }
  async retrieve(query: string, options: { role?: "planner" | "implementer" | "reviewer"; contextLimit?: 16384 | 32768; revision?: string; limit?: number } = {}): Promise<CodingRetrievalReport> {
    await this.initialize();
    const generation = this.activeGeneration();
    const emptyDiagnostics = { filesDiscovered: 0, filesSkipped: 0, chunksProduced: 0, chunksEmbedded: 0, errors: [] as string[] };
    if (!generation) return { repositoryId: this.repositoryId, query, generation: null, vectorAvailable: false, lexicalCandidates: [], vectorCandidates: [], selected: [], omitted: 0, contextCharacters: 0, diagnostics: emptyDiagnostics };
    const queryTokens = tokenize(query);
    const queryVector = this.embedding.available ? this.embedding.embed(query) : [];
    const rows = this.db().prepare("SELECT metadata_json, content, vector_json FROM coding_chunks WHERE generation_id = ?").all(generation.generationId) as Array<{ metadata_json: string; content: string; vector_json: string }>;
    const candidates = rows.map((row) => {
      const chunk = { ...JSON.parse(row.metadata_json), content: row.content, vector: JSON.parse(row.vector_json) } as CodingChunk;
      const searchable = `${chunk.path}\n${chunk.symbolName ?? ""}\n${chunk.content}`.toLocaleLowerCase();
      const exactMatches = queryTokens.filter((token) => searchable.includes(token)).length;
      const lexicalScore = queryTokens.length ? exactMatches / queryTokens.length : 0;
      const vectorScore = queryVector.length ? cosine(queryVector, chunk.vector) : 0;
      const metadataBoost = (chunk.symbolName && query.toLocaleLowerCase().includes(chunk.symbolName.toLocaleLowerCase()) ? 0.35 : 0) + (query.toLocaleLowerCase().includes(chunk.path.toLocaleLowerCase()) ? 0.5 : 0) + (options.role === "reviewer" && chunk.classification === "test" ? 0.08 : 0);
      return { ...chunk, lexicalScore, vectorScore, metadataBoost, fusedScore: lexicalScore * 0.62 + vectorScore * 0.30 + metadataBoost, relationship: null, current: true } satisfies CodingRetrievalCandidate;
    }).filter((candidate) => candidate.lexicalScore > 0 || candidate.vectorScore > 0).sort((left, right) => right.fusedScore - left.fusedScore);
    const primary = candidates.slice(0, options.limit ?? 16);
    const expanded = this.expandRelationships(primary, candidates).slice(0, 4);
    const selected = [...new Map([...primary, ...expanded].map((item) => [item.id, item])).values()];
    const characterBudget = Math.floor((options.contextLimit ?? 32768) * 3.6 * 0.26);
    let used = 0;
    const rehydrated: CodingRetrievalCandidate[] = [];
    for (const candidate of selected) {
      const exact = await this.rehydrate(candidate);
      if (!exact || used + exact.length > characterBudget) continue;
      used += exact.length;
      rehydrated.push({ ...candidate, exactContent: exact });
    }
    return { repositoryId: this.repositoryId, query, generation, vectorAvailable: this.embedding.available, lexicalCandidates: candidates.filter((candidate) => candidate.lexicalScore > 0).slice(0, 16), vectorCandidates: candidates.filter((candidate) => candidate.vectorScore > 0).slice(0, 16), selected: rehydrated, omitted: Math.max(0, selected.length - rehydrated.length), contextCharacters: used, diagnostics: emptyDiagnostics };
  }
  private expandRelationships(primary: CodingRetrievalCandidate[], candidates: CodingRetrievalCandidate[]) {
    const names = new Set(primary.flatMap((candidate) => [candidate.symbolName, ...candidate.exports]).filter((value): value is string => Boolean(value)));
    return candidates
      .filter((candidate) => !primary.some((selected) => selected.id === candidate.id)
        && (candidate.classification === "test"
          || candidate.imports.some((entry) => [...names].some((name) => entry.includes(name)))
          || names.has(candidate.symbolName ?? "")))
      .map((candidate) => ({ ...candidate, relationship: candidate.classification === "test" ? "related-test" : "symbol-reference" }));
  }
  private async rehydrate(candidate: CodingRetrievalCandidate) {
    try {
      const content = await readFile(path.join(this.repositoryRoot, candidate.path), "utf8");
      const currentHash = hash(content.split("\n").slice(candidate.startLine - 1, candidate.endLine).join("\n"));
      if (currentHash !== candidate.contentHash) return null;
      return content.split("\n").slice(candidate.startLine - 1, candidate.endLine).map((line, index) => `${candidate.startLine + index}: ${line}`).join("\n");
    } catch { return null; }
  }
  private db() { if (!this.database) throw new Error("Coding index must be initialized before use."); return this.database; }
}
