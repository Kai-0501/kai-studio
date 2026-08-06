import path from "node:path";
import { CodingHybridIndex } from "@/lib/coding-retrieval";
import { createScopedHashEmbedder } from "@/lib/retrieval/embedding-provider";
import { embeddingIdentity } from "@/lib/retrieval/identity";
import { readSettings } from "@/lib/settings-store";
import { withEmbeddingLease } from "@/lib/embedding-runtime";

/**
 * Coding retrieval intentionally has no dependency on KaiLore runtime. A
 * configured embedding model without a validated local adapter yields safe
 * lexical-only retrieval instead of borrowing another role's model.
 */
export async function codingRetrievalIndex(repositoryRoot: string, repositoryId: string) {
  const settings = await readSettings();
  const modelId = settings.modelAssignments.codingEmbedding;
  const identity = embeddingIdentity("coding", modelId);
  const index = new CodingHybridIndex(path.resolve(repositoryRoot), repositoryId, createScopedHashEmbedder(identity));
  const runtime = { domain: "coding" as const, role: "coding.embedding" as const, modelId, modelTag: modelId, ownership: modelId.includes(":") ? "shared-ollama" as const : "unsupported" as const, runtime: modelId.includes(":") ? "ollama" as const : "external" as const, policy: settings.embeddingRuntime.coding };
  return Object.assign(index, { withLease<T>(operation: () => Promise<T> | T) { return withEmbeddingLease(runtime, operation); } }) as CodingHybridIndex & { withLease<T>(operation: () => Promise<T> | T): Promise<T> };
}
