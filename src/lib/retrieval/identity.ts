import { createHash } from "node:crypto";

export type RetrievalDomain = "kailore" | "coding";

export type EmbeddingIdentity = {
  retrievalDomain: RetrievalDomain;
  modelId: string;
  modelRevision: string;
  dimensions: number;
  normalization: "l2" | "none";
  metric: "cosine";
  chunkerVersion: string;
  schemaVersion: number;
};

export type IndexGeneration = EmbeddingIdentity & {
  generationId: string;
  corpusVersion: string;
  createdAt: string;
  updatedAt: string;
  status: "staging" | "active" | "legacy" | "failed";
};

export function embeddingIdentity(
  retrievalDomain: RetrievalDomain,
  modelId: string,
  options: Partial<Omit<EmbeddingIdentity, "retrievalDomain" | "modelId">> = {},
): EmbeddingIdentity {
  return {
    retrievalDomain,
    modelId,
    modelRevision: options.modelRevision ?? "local-v1",
    dimensions: options.dimensions ?? 64,
    normalization: options.normalization ?? "l2",
    metric: "cosine",
    chunkerVersion: options.chunkerVersion ?? (retrievalDomain === "coding" ? "code-aware-v1" : "kailore-v1"),
    schemaVersion: options.schemaVersion ?? 1,
  };
}

export function compatibleIndex(left: EmbeddingIdentity, right: EmbeddingIdentity) {
  return left.retrievalDomain === right.retrievalDomain
    && left.modelId === right.modelId
    && left.modelRevision === right.modelRevision
    && left.dimensions === right.dimensions
    && left.normalization === right.normalization
    && left.metric === right.metric
    && left.chunkerVersion === right.chunkerVersion
    && left.schemaVersion === right.schemaVersion;
}

export function generationId(identity: EmbeddingIdentity, corpusVersion: string) {
  return createHash("sha256")
    .update(JSON.stringify({ ...identity, corpusVersion }))
    .digest("hex")
    .slice(0, 20);
}
