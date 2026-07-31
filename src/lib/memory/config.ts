import path from "node:path";
import type { MemoryRetrievalOptions } from "@/types/memory";

export const kaiStudioDataDirectory =
  process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.cwd(), ".promptdeck");

export const kaiLoreRoot =
  process.env.KAI_STUDIO_KAILORE_DIR ??
  path.join(kaiStudioDataDirectory, "KaiLore");

export const memoryIndexFile =
  process.env.KAI_STUDIO_MEMORY_INDEX ??
  path.join(kaiStudioDataDirectory, "memory-index.sqlite");

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const defaultRetrievalOptions: MemoryRetrievalOptions = {
  topK: positiveInteger(process.env.KAI_STUDIO_MEMORY_TOP_K, 6),
  candidateLimit: positiveInteger(
    process.env.KAI_STUDIO_MEMORY_CANDIDATES,
    30,
  ),
  maxCharacters: positiveInteger(
    process.env.KAI_STUDIO_MEMORY_MAX_CHARACTERS,
    12_000,
  ),
  maxPerDomain: positiveInteger(
    process.env.KAI_STUDIO_MEMORY_MAX_PER_DOMAIN,
    3,
  ),
  minimumScore: finiteNumber(
    process.env.KAI_STUDIO_MEMORY_MINIMUM_SCORE,
    0.08,
  ),
};

export const memoryCacheOptions = {
  maxEntries: positiveInteger(process.env.KAI_STUDIO_MEMORY_CACHE_ENTRIES, 64),
  maxBytes: positiveInteger(
    process.env.KAI_STUDIO_MEMORY_CACHE_BYTES,
    2_000_000,
  ),
  ttlMs: positiveInteger(process.env.KAI_STUDIO_MEMORY_CACHE_TTL_MS, 900_000),
};
