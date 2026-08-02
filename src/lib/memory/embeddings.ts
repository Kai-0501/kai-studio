export type EmbeddingProvider = { id: string; version: string; enabled: boolean; dimensions: number; embed(text: string): number[] };

function hashEmbedding(text: string, dimensions = 64) {
  const values = Array.from({ length: dimensions }, () => 0);
  for (const token of text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let hash = 2166136261;
    for (const char of token) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const index = Math.abs(hash) % dimensions;
    values[index] += 1;
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

export const localEmbeddingProvider: EmbeddingProvider = {
  id: process.env.KAI_EMBEDDING_PROVIDER ?? "local-hash",
  version: "phase2a-1",
  enabled: process.env.KAI_STUDIO_DENSE_MEMORY !== "0",
  dimensions: 64,
  embed: hashEmbedding,
};

export function denseCosine(left: number[], right: number[]) {
  if (!left.length || !right.length) return 0;
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}
