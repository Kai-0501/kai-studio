import type {
  MemoryRetrievalOptions,
  MemoryRetrievalReport,
  RetrievedMemory,
} from "@/types/memory";
import { WeightedLruCache } from "@/lib/memory/cache";
import {
  defaultRetrievalOptions,
  memoryCacheOptions,
} from "@/lib/memory/config";
import {
  type MemoryIndexStats,
  sparseVector,
  SqliteMemoryIndex,
} from "@/lib/memory/index-store";

export interface MemoryRetriever {
  retrieve(
    query: string,
    options?: Partial<MemoryRetrievalOptions>,
  ): Promise<MemoryRetrievalReport>;
}

function cosine(
  left: Record<string, number>,
  right: Record<string, number>,
) {
  const [small, large] =
    Object.keys(left).length < Object.keys(right).length
      ? [left, right]
      : [right, left];
  let score = 0;
  for (const [token, weight] of Object.entries(small)) {
    score += weight * (large[token] ?? 0);
  }
  return score;
}

function normalize(text: string) {
  return text.toLocaleLowerCase();
}

function recencyScore(date: string | null) {
  if (!date) return 0;
  const age = Date.now() - new Date(date).getTime();
  if (!Number.isFinite(age) || age < 0) return 0;
  return Math.exp(-age / (1000 * 60 * 60 * 24 * 365));
}

export class HybridMemoryRetriever implements MemoryRetriever {
  private readonly resultCache = new WeightedLruCache<MemoryRetrievalReport>(
    memoryCacheOptions,
  );
  private lastStats: MemoryIndexStats = {
    indexedRecords: 0,
    indexedFiles: 0,
    reindexedFiles: 0,
    skippedFiles: 0,
  };
  private readonly index: SqliteMemoryIndex;

  constructor(index: SqliteMemoryIndex) {
    this.index = index;
  }

  async retrieve(
    query: string,
    overrides: Partial<MemoryRetrievalOptions> = {},
  ): Promise<MemoryRetrievalReport> {
    const options = { ...defaultRetrievalOptions, ...overrides };
    const cacheKey = JSON.stringify([query.trim().toLocaleLowerCase(), options]);
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      return { ...cached, cache: this.resultCache.metrics() };
    }

    this.lastStats = await this.index.sync();
    const queryVector = sparseVector(query);
    const normalizedQuery = normalize(query);
    const initiallyRanked = this.index
      .candidates(query, options.candidateLimit)
      .map(({ record, lexicalRank, vector }) => {
        const matchedEntities = [...record.people, ...record.entities].filter(
          (entity) => normalizedQuery.includes(normalize(entity)),
        );
        const matchedTags = record.tags.filter((tag) =>
          normalizedQuery.includes(normalize(tag)),
        );
        const lexical = 1 / (1 + Math.abs(lexicalRank));
        const semantic = cosine(queryVector, vector);
        const entityBoost = Math.min(0.3, matchedEntities.length * 0.16);
        const tagBoost = Math.min(0.15, matchedTags.length * 0.08);
        const freshness = recencyScore(record.updatedAt) * 0.05;
        const frequency = Math.min(0.05, Math.log1p(record.accessCount) * 0.01);
        const score =
          lexical * 0.28 +
          semantic * 0.38 +
          entityBoost +
          tagBoost +
          record.importance * 0.08 +
          freshness +
          frequency;
        return {
          record,
          provenance: {
            recordId: record.id,
            sourceFile: record.sourceFile,
            score,
            matchedEntities,
            matchedTags,
          },
          estimatedCharacters: record.content.length,
        } satisfies RetrievedMemory;
      })
      .filter((item) => item.provenance.score >= options.minimumScore)
      .sort((a, b) => b.provenance.score - a.provenance.score);
    const explicitlySuperseded = new Set(
      initiallyRanked.flatMap((item) => item.record.supersedes),
    );
    const ranked = initiallyRanked.filter(
      (item) => !explicitlySuperseded.has(item.record.id),
    );

    const retrieved: RetrievedMemory[] = [];
    const domains = new Map<string, number>();
    let totalCharacters = 0;
    for (const item of ranked) {
      const domainCount = domains.get(item.record.domain) ?? 0;
      if (domainCount >= options.maxPerDomain) continue;
      if (
        retrieved.length >= options.topK ||
        totalCharacters + item.estimatedCharacters > options.maxCharacters
      ) {
        continue;
      }
      retrieved.push(item);
      totalCharacters += item.estimatedCharacters;
      domains.set(item.record.domain, domainCount + 1);
    }

    this.index.markAccessed(retrieved.map((item) => item.record.id));
    const report: MemoryRetrievalReport = {
      query,
      retrieved,
      totalCharacters,
      cache: this.resultCache.metrics(),
      ...this.lastStats,
    };
    this.resultCache.set(cacheKey, report, totalCharacters + query.length);
    return { ...report, cache: this.resultCache.metrics() };
  }

  metrics() {
    return this.resultCache.metrics();
  }

  stats() {
    return this.lastStats;
  }
}
