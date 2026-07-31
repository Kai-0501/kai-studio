import type { RetrievedMemory } from "@/types/memory";
import { WeightedLruCache } from "@/lib/memory/cache";

type WorkingMemory = {
  records: RetrievedMemory[];
  updatedAt: string;
};

const sessions = new WeightedLruCache<WorkingMemory>({
  maxEntries: 32,
  maxBytes: 4_000_000,
  ttlMs: 60 * 60 * 1000,
});

export function readWorkingMemory(sessionId: string) {
  return sessions.get(sessionId)?.records ?? [];
}

export function updateWorkingMemory(
  sessionId: string,
  retrieved: RetrievedMemory[],
) {
  const existing = readWorkingMemory(sessionId);
  const unique = new Map(
    [...retrieved, ...existing].map((item) => [item.record.id, item]),
  );
  const records = [...unique.values()].slice(0, 10);
  sessions.set(
    sessionId,
    { records, updatedAt: new Date().toISOString() },
    records.reduce(
      (total, item) => total + item.record.content.length + 500,
      0,
    ),
  );
  return records;
}

export function clearWorkingMemory(sessionId: string) {
  sessions.delete(sessionId);
}

export function workingMemoryMetrics() {
  return sessions.metrics();
}
