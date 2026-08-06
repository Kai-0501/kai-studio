import type { EmbeddingIdentity } from "@/lib/retrieval/identity";

export type ScopedEmbeddingProvider = {
  identity: EmbeddingIdentity;
  available: boolean;
  embed(text: string): number[];
};

/**
 * Deterministic local fallback used for fixtures and for existing KaiLore
 * indexes. It is intentionally provider-neutral: a future embedding runtime
 * replaces this adapter, not either retrieval domain or its stored vectors.
 */
export function createScopedHashEmbedder(identity: EmbeddingIdentity): ScopedEmbeddingProvider {
  return {
    identity,
    available: identity.modelId === "local-hash" || identity.modelId === "local.memory-hash-embedding",
    embed(text) {
      const values = Array.from({ length: identity.dimensions }, () => 0);
      for (const token of text.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []) {
        let hash = 2166136261;
        for (const char of token) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
        values[Math.abs(hash) % identity.dimensions] += 1;
      }
      if (identity.normalization === "none") return values;
      const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
      return values.map((value) => value / norm);
    },
  };
}

export function cosine(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}
