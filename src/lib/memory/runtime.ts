import type { MemoryRetrievalReport } from "@/types/memory";
import { kaiLoreRoot, memoryIndexFile } from "@/lib/memory/config";
import { SqliteMemoryIndex } from "@/lib/memory/index-store";
import { HybridMemoryRetriever } from "@/lib/memory/retriever";
import { readSettings } from "@/lib/settings-store";
import { createScopedHashEmbedder } from "@/lib/retrieval/embedding-provider";
import { embeddingIdentity } from "@/lib/retrieval/identity";
import type { EmbeddingRuntimeDescriptor } from "@/lib/embedding-runtime";

const index = new SqliteMemoryIndex(kaiLoreRoot, memoryIndexFile);
export const longTermMemoryRetriever = new HybridMemoryRetriever(index);
const configuredRetrievers = new Map<string, HybridMemoryRetriever>();

/** Resolves only the KaiLore assignment. Coding never imports this function. */
export async function kaiLoreMemoryRetriever() {
  const settings = await readSettings();
  const modelId = settings.modelAssignments.kaiLoreEmbedding;
  const key = modelId || "local-hash";
  const existing = configuredRetrievers.get(key);
  if (existing) return existing;
  const provider = createScopedHashEmbedder(embeddingIdentity("kailore", key));
  const runtime: EmbeddingRuntimeDescriptor = {
    domain: "kailore", role: "kailore.embedding", modelId: key, modelTag: key,
    ownership: key.startsWith("gemma") || key.includes(":") ? "shared-ollama" : "unsupported",
    runtime: key.includes(":") ? "ollama" : "external",
    policy: settings.embeddingRuntime.kaiLore,
  };
  const retriever = new HybridMemoryRetriever(new SqliteMemoryIndex(kaiLoreRoot, memoryIndexFile, { embedding: provider }), runtime);
  configuredRetrievers.set(key, retriever);
  return retriever;
}

const reports = new Map<string, MemoryRetrievalReport>();

export function rememberRetrievalReport(
  sessionId: string,
  report: MemoryRetrievalReport,
) {
  reports.set(sessionId, report);
  if (reports.size > 50) reports.delete(reports.keys().next().value as string);
}

export function latestRetrievalReport(sessionId: string) {
  return reports.get(sessionId) ?? null;
}

export function createMemoryCandidate() {
  throw new Error(
    "Permanent memory writing requires a future human-review workflow.",
  );
}
