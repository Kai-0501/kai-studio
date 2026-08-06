import { kaiLoreMemoryRetriever } from "@/lib/memory/runtime";
import { memoryContextSystemMessage } from "@/lib/memory/prompt";
import { readSettings } from "@/lib/settings-store";
import type { CanonicalMessage } from "@/lib/models/types";

export async function agentMemoryContext(query: string): Promise<CanonicalMessage[]> {
  try {
    const settings = await readSettings();
    if (!settings.longTermMemoryEnabled) return [];
    const report = await (await kaiLoreMemoryRetriever()).retrieve(query.slice(0, 4_000));
    if (!report.retrieved.length) return [];
    return [{ role: "system", content: memoryContextSystemMessage(report.retrieved) }];
  } catch {
    // Memory is enrichment, never a dependency for security or coding.
    return [];
  }
}
