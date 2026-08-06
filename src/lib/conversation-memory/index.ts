import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createScopedHashEmbedder, cosine } from "@/lib/retrieval/embedding-provider";
import { embeddingIdentity } from "@/lib/retrieval/identity";
import { sparseVector } from "@/lib/memory/index-store";
import type { ConversationMessage, SavedRun } from "@/types/run";

type Row = Record<string, unknown>;
export type ConversationEvidence = { chunkId: string; conversationId: string; branchId: string; messageIds: string[]; text: string; sequenceStart: number; sequenceEnd: number; topic: string; timestamp: string; contentHash: string; score: number };

function tokens(text: string) { return text.toLocaleLowerCase().match(/[\p{L}\p{N}_'-]{2,}/gu) ?? []; }
function naturalSegments(message: ConversationMessage) {
  const blocks = message.content.split(/\n(?=#{1,3}\s|\*\*[^*]+\*\*|---+$)|\n{2,}/m).map((item) => item.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;
  return message.content.length > 3200 ? message.content.match(/[\s\S]{1,2800}(?:\s|$)/g)?.map((item) => item.trim()).filter(Boolean) ?? [message.content] : [message.content];
}
function lexical(query: string, text: string) {
  const wanted = new Set(tokens(query)); if (!wanted.size) return 0;
  const found = new Set(tokens(text)); return [...wanted].filter((token) => found.has(token)).length / Math.sqrt(wanted.size * Math.max(1, found.size));
}

export class ConversationMemoryIndex {
  private database: DatabaseSync | null = null;
  private readonly file: string;
  private readonly embedder;
  constructor(file = path.join(process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.cwd(), ".promptdeck"), "conversation-index.sqlite"), modelId = "local-hash") {
    this.file = file;
    this.embedder = createScopedHashEmbedder(embeddingIdentity("conversation", modelId, { chunkerVersion: "conversation-natural-v1", schemaVersion: 1 }));
  }
  async initialize() {
    if (this.database) return;
    await mkdir(path.dirname(this.file), { recursive: true });
    this.database = new DatabaseSync(this.file);
    this.database.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS conversation_chunks (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, branch_id TEXT NOT NULL, message_ids_json TEXT NOT NULL, sequence_start INTEGER NOT NULL, sequence_end INTEGER NOT NULL, roles TEXT NOT NULL, topic TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL, source_timestamp TEXT NOT NULL, checkpoint_version INTEGER NOT NULL, vector_json TEXT NOT NULL, dense_vector_json TEXT NOT NULL, indexed_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS conversation_scope ON conversation_chunks(conversation_id, branch_id, sequence_start); CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(chunk_id UNINDEXED, conversation_id UNINDEXED, topic, content, tokenize='unicode61 remove_diacritics 2'); CREATE TABLE IF NOT EXISTS conversation_generations (conversation_id TEXT PRIMARY KEY, generation_id TEXT NOT NULL, model_id TEXT NOT NULL, model_revision TEXT NOT NULL, chunker_version TEXT NOT NULL, schema_version INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  }
  async indexRun(run: SavedRun) {
    await this.initialize();
    if (!run.messages?.length || !run.activeBranchId) return { indexed: 0 };
    const messages = run.messages.filter((message) => !message.deletedAt && message.branchId === run.activeBranchId);
    const chunks = messages.flatMap((message, index) => naturalSegments(message).map((text, part) => {
      const contentHash = createHash("sha256").update(`${message.contentHash}:${part}:${text}`).digest("hex");
      return { id: `conv-${contentHash.slice(0, 24)}`, conversationId: run.id, branchId: run.activeBranchId!, messageIds: [message.id], sequenceStart: index, sequenceEnd: index, roles: message.role, topic: text.split(/\n|[.!?]/)[0].slice(0, 160), text, contentHash, timestamp: message.updatedAt, checkpointVersion: run.checkpoint?.version ?? 0 };
    }));
    const db = this.database!; db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM conversation_fts WHERE conversation_id = ?").run(run.id);
      db.prepare("DELETE FROM conversation_chunks WHERE conversation_id = ?").run(run.id);
      const insert = db.prepare("INSERT INTO conversation_chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const fts = db.prepare("INSERT INTO conversation_fts(chunk_id, conversation_id, topic, content) VALUES (?, ?, ?, ?)");
      for (const chunk of chunks) { const searchable = `${chunk.topic}\n${chunk.text}`; insert.run(chunk.id, chunk.conversationId, chunk.branchId, JSON.stringify(chunk.messageIds), chunk.sequenceStart, chunk.sequenceEnd, chunk.roles, chunk.topic, chunk.text, chunk.contentHash, chunk.timestamp, chunk.checkpointVersion, JSON.stringify(sparseVector(searchable)), JSON.stringify(this.embedder.embed(searchable)), new Date().toISOString()); fts.run(chunk.id, run.id, chunk.topic, chunk.text); }
      const generation = createHash("sha256").update(JSON.stringify(chunks.map((chunk) => chunk.contentHash))).digest("hex").slice(0, 20);
      db.prepare("INSERT INTO conversation_generations VALUES (?, ?, ?, ?, ?, ?, 'active', ?) ON CONFLICT(conversation_id) DO UPDATE SET generation_id=excluded.generation_id, model_id=excluded.model_id, model_revision=excluded.model_revision, chunker_version=excluded.chunker_version, schema_version=excluded.schema_version, status='active', updated_at=excluded.updated_at").run(run.id, generation, this.embedder.identity.modelId, this.embedder.identity.modelRevision, this.embedder.identity.chunkerVersion, this.embedder.identity.schemaVersion, new Date().toISOString());
      db.exec("COMMIT"); return { indexed: chunks.length, generation };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  async search(conversationId: string, branchId: string, query: string, topK: number, tokenBudget: number) {
    await this.initialize();
    const rows = this.database!.prepare("SELECT * FROM conversation_chunks WHERE conversation_id = ? AND branch_id = ?").all(conversationId, branchId) as Row[];
    const qv = this.embedder.embed(query);
    const ranked = rows.map((row) => ({ row, score: lexical(query, String(row.content)) * 0.55 + cosine(qv, JSON.parse(String(row.dense_vector_json))) * 0.45 })).sort((a, b) => b.score - a.score);
    let used = 0; const selected: ConversationEvidence[] = [];
    for (const { row, score } of ranked) { if (selected.length >= topK || score <= 0) break; const text = String(row.content); const estimate = Math.ceil(text.length / 4); if (used + estimate > tokenBudget) continue; used += estimate; selected.push({ chunkId: String(row.id), conversationId, branchId, messageIds: JSON.parse(String(row.message_ids_json)), text, sequenceStart: Number(row.sequence_start), sequenceEnd: Number(row.sequence_end), topic: String(row.topic), timestamp: String(row.source_timestamp), contentHash: String(row.content_hash), score }); }
    return selected;
  }
  async deleteConversation(conversationId: string) { await this.initialize(); this.database!.prepare("DELETE FROM conversation_fts WHERE conversation_id = ?").run(conversationId); this.database!.prepare("DELETE FROM conversation_chunks WHERE conversation_id = ?").run(conversationId); this.database!.prepare("DELETE FROM conversation_generations WHERE conversation_id = ?").run(conversationId); }
  async status(conversationId?: string) { await this.initialize(); const count = this.database!.prepare(`SELECT COUNT(*) count FROM conversation_chunks${conversationId ? " WHERE conversation_id = ?" : ""}`).get(...(conversationId ? [conversationId] : [])) as Row; const generation = conversationId ? this.database!.prepare("SELECT * FROM conversation_generations WHERE conversation_id = ?").get(conversationId) : null; return { indexedChunks: Number(count.count), generation: generation ?? null }; }
  close() { this.database?.close(); this.database = null; }
}
