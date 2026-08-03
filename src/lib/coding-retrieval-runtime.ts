import path from "node:path";
import { CodingHybridIndex } from "@/lib/coding-retrieval";
import { createScopedHashEmbedder } from "@/lib/retrieval/embedding-provider";
import { embeddingIdentity } from "@/lib/retrieval/identity";
import { readSettings } from "@/lib/settings-store";

/**
 * Coding retrieval intentionally has no dependency on KaiLore runtime. A
 * configured embedding model without a validated local adapter yields safe
 * lexical-only retrieval instead of borrowing another role's model.
 */
export async function codingRetrievalIndex(repositoryRoot: string, repositoryId: string) {
  const settings = await readSettings();
  const modelId = settings.modelAssignments.codingEmbedding;
  const identity = embeddingIdentity("coding", modelId);
  return new CodingHybridIndex(path.resolve(repositoryRoot), repositoryId, createScopedHashEmbedder(identity));
}
