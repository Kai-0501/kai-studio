import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MemoryRecord } from "@/types/memory";
import { memoryIndexFile } from "@/lib/memory/config";
import { parseMarkdownMemory } from "@/lib/memory/frontmatter";

type DatabaseRow = Record<string, unknown>;

export type MemoryIndexStats = {
  indexedRecords: number;
  indexedFiles: number;
  reindexedFiles: number;
  skippedFiles: number;
};

export type IndexedCandidate = {
  record: MemoryRecord;
  lexicalRank: number;
  vector: Record<string, number>;
};

function tokenize(text: string) {
  return (
    text
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu) ?? []
  ).filter((token) => token.length > 1);
}

export function sparseVector(text: string) {
  const counts: Record<string, number> = {};
  for (const token of tokenize(text)) counts[token] = (counts[token] ?? 0) + 1;
  const norm = Math.sqrt(
    Object.values(counts).reduce((total, count) => total + count * count, 0),
  );
  if (!norm) return counts;
  for (const token of Object.keys(counts)) counts[token] /= norm;
  return counts;
}

function databaseRecord(row: DatabaseRow): MemoryRecord {
  const metadata = JSON.parse(String(row.metadata_json)) as Omit<
    MemoryRecord,
    "content" | "accessCount" | "lastAccessedAt"
  >;
  return {
    ...metadata,
    content: String(row.content),
    accessCount: Number(row.access_count),
    lastAccessedAt:
      typeof row.last_accessed_at === "string" ? row.last_accessed_at : null,
  };
}

async function markdownFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .map(async (entry) => {
          const absolute = path.join(root, entry.name);
          if (entry.isDirectory()) return markdownFiles(absolute);
          return entry.isFile() && /\.md$/i.test(entry.name) ? [absolute] : [];
        }),
    );
    return nested.flat().sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export class SqliteMemoryIndex {
  private database: DatabaseSync | null = null;
  private readonly rootDirectory: string;
  private readonly databaseFile: string;

  constructor(
    rootDirectory: string,
    databaseFile = memoryIndexFile,
  ) {
    this.rootDirectory = rootDirectory;
    this.databaseFile = databaseFile;
  }

  async initialize() {
    if (this.database) return;
    await mkdir(path.dirname(this.databaseFile), { recursive: true });
    this.database = new DatabaseSync(this.databaseFile);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        source_file TEXT NOT NULL UNIQUE,
        content_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        domain TEXT NOT NULL,
        content TEXT NOT NULL,
        searchable_text TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS indexed_files (
        source_file TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        modified_at TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        record_id UNINDEXED,
        title,
        domain,
        entities,
        tags,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
  }

  async sync(): Promise<MemoryIndexStats> {
    await this.initialize();
    const database = this.db();
    const files = await markdownFiles(this.rootDirectory);
    let reindexedFiles = 0;
    let skippedFiles = 0;

    for (const absoluteFile of files) {
      const relative = path
        .relative(this.rootDirectory, absoluteFile)
        .split(path.sep)
        .join("/");
      const markdown = await readFile(absoluteFile, "utf8");
      const hash = createHash("sha256").update(markdown).digest("hex");
      const existing = database
        .prepare(
          "SELECT content_hash FROM indexed_files WHERE source_file = ?",
        )
        .get(relative) as DatabaseRow | undefined;
      if (existing?.content_hash === hash) {
        skippedFiles += 1;
        continue;
      }

      const record = parseMarkdownMemory(markdown, relative);
      const fileStat = await stat(absoluteFile);
      this.upsert(record, fileStat.mtime.toISOString());
      reindexedFiles += 1;
    }

    const count = database
      .prepare("SELECT COUNT(*) AS count FROM memory_records")
      .get() as DatabaseRow;
    return {
      indexedRecords: Number(count.count),
      indexedFiles: files.length,
      reindexedFiles,
      skippedFiles,
    };
  }

  candidates(query: string, limit: number): IndexedCandidate[] {
    const tokens = [...new Set(tokenize(query))].slice(0, 24);
    if (!tokens.length) return [];
    const ftsQuery = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
    const rows = this.db()
      .prepare(
        `SELECT r.*, bm25(memory_fts, 0, 3, 1, 4, 3, 1) AS lexical_rank
         FROM memory_fts
         JOIN memory_records r ON r.id = memory_fts.record_id
         WHERE memory_fts MATCH ?
         ORDER BY lexical_rank
         LIMIT ?`,
      )
      .all(ftsQuery, limit) as DatabaseRow[];

    return rows
      .map((row) => ({
        record: databaseRecord(row),
        lexicalRank: Number(row.lexical_rank),
        vector: JSON.parse(String(row.vector_json)) as Record<string, number>,
      }))
      .filter(
        ({ record }) =>
          record.status !== "forgotten" &&
          record.status !== "deprecated" &&
          record.status !== "superseded" &&
          record.operation !== "delete" &&
          record.operation !== "forget",
      );
  }

  get(id: string): MemoryRecord | null {
    const row = this.db()
      .prepare("SELECT * FROM memory_records WHERE id = ?")
      .get(id) as DatabaseRow | undefined;
    return row ? databaseRecord(row) : null;
  }

  markAccessed(ids: string[]) {
    if (!ids.length) return;
    const update = this.db().prepare(
      `UPDATE memory_records
       SET access_count = access_count + 1, last_accessed_at = ?
       WHERE id = ?`,
    );
    const now = new Date().toISOString();
    this.db().exec("BEGIN");
    try {
      for (const id of ids) update.run(now, id);
      this.db().exec("COMMIT");
    } catch (error) {
      this.db().exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database?.close();
    this.database = null;
  }

  private upsert(record: MemoryRecord, modifiedAt: string) {
    const database = this.db();
    const searchableText = [
      record.title,
      record.domain,
      record.category,
      ...record.people,
      ...record.entities,
      ...record.tags,
      record.content,
    ].join("\n");
    const metadata = {
      ...record,
      content: undefined,
      accessCount: undefined,
      lastAccessedAt: undefined,
    };
    database.exec("BEGIN");
    try {
      database
        .prepare(
          "DELETE FROM memory_records WHERE source_file = ? AND id <> ?",
        )
        .run(record.sourceFile, record.id);
      database
        .prepare(
          `INSERT INTO memory_records (
             id, source_file, content_hash, title, domain, content,
             searchable_text, metadata_json, vector_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             source_file = excluded.source_file,
             content_hash = excluded.content_hash,
             title = excluded.title,
             domain = excluded.domain,
             content = excluded.content,
             searchable_text = excluded.searchable_text,
             metadata_json = excluded.metadata_json,
             vector_json = excluded.vector_json`,
        )
        .run(
          record.id,
          record.sourceFile,
          record.contentHash,
          record.title,
          record.domain,
          record.content,
          searchableText,
          JSON.stringify(metadata),
          JSON.stringify(sparseVector(searchableText)),
        );
      database.prepare("DELETE FROM memory_fts WHERE record_id = ?").run(record.id);
      database
        .prepare(
          `INSERT INTO memory_fts
           (record_id, title, domain, entities, tags, content)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          record.title,
          record.domain,
          [...record.people, ...record.entities].join(" "),
          record.tags.join(" "),
          record.content,
        );
      database
        .prepare(
          `INSERT INTO indexed_files
           (source_file, content_hash, modified_at, indexed_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(source_file) DO UPDATE SET
             content_hash = excluded.content_hash,
             modified_at = excluded.modified_at,
             indexed_at = excluded.indexed_at`,
        )
        .run(
          record.sourceFile,
          record.contentHash,
          modifiedAt,
          new Date().toISOString(),
        );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  private db() {
    if (!this.database) {
      throw new Error("Memory index must be initialized before use.");
    }
    return this.database;
  }
}
