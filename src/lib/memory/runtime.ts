import type { MemoryRetrievalReport } from "@/types/memory";
import { kaiLoreRoot, memoryIndexFile } from "@/lib/memory/config";
import { SqliteMemoryIndex } from "@/lib/memory/index-store";
import { HybridMemoryRetriever } from "@/lib/memory/retriever";

const index = new SqliteMemoryIndex(kaiLoreRoot, memoryIndexFile);
export const longTermMemoryRetriever = new HybridMemoryRetriever(index);

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
