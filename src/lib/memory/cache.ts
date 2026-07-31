import type { MemoryCacheMetrics } from "@/types/memory";

type Entry<T> = {
  value: T;
  bytes: number;
  expiresAt: number;
  frequency: number;
  lastAccessed: number;
};

export class WeightedLruCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private bytes = 0;
  private readonly options: {
    maxEntries: number;
    maxBytes: number;
    ttlMs: number;
  };

  constructor(options: {
    maxEntries: number;
    maxBytes: number;
    ttlMs: number;
  }) {
    this.options = options;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.misses += 1;
      if (entry) this.remove(key, true);
      return undefined;
    }
    this.hits += 1;
    entry.frequency += 1;
    entry.lastAccessed = Date.now();
    return entry.value;
  }

  set(key: string, value: T, estimatedBytes: number) {
    this.remove(key, false);
    const bytes = Math.max(1, estimatedBytes);
    this.entries.set(key, {
      value,
      bytes,
      expiresAt: Date.now() + this.options.ttlMs,
      frequency: 1,
      lastAccessed: Date.now(),
    });
    this.bytes += bytes;
    this.evict();
  }

  delete(key: string) {
    this.remove(key, false);
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }

  metrics(): MemoryCacheMetrics {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      entries: this.entries.size,
      estimatedBytes: this.bytes,
    };
  }

  private remove(key: string, eviction: boolean) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    if (eviction) this.evictions += 1;
  }

  private evict() {
    while (
      this.entries.size > this.options.maxEntries ||
      this.bytes > this.options.maxBytes
    ) {
      const victim = [...this.entries.entries()].sort(([, a], [, b]) => {
        const aWeight = a.lastAccessed + a.frequency * 30_000;
        const bWeight = b.lastAccessed + b.frequency * 30_000;
        return aWeight - bWeight;
      })[0];
      if (!victim) break;
      this.remove(victim[0], true);
    }
  }
}
