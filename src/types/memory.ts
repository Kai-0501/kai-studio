export type KaiMemory = {
  content: string;
  updatedAt: string;
  sourceName?: string;
};

export type KaiMemoryStatus = {
  active: boolean;
  content: string;
  updatedAt: string | null;
  sourceName?: string;
  characterCount: number;
  wordCount: number;
};

export type MemoryConfidence = "low" | "medium" | "high" | "unknown";
export type MemoryStatus =
  | "active"
  | "uncertain"
  | "superseded"
  | "deprecated"
  | "forgotten";
export type MemoryOperation =
  | "upsert"
  | "supersede"
  | "deprecate"
  | "delete"
  | "forget";

export type MemoryRelationship = {
  type: string;
  targetId: string;
};

/**
 * Stable application-layer representation of one human-editable KaiLore record.
 * Unknown values stay absent; parsers must never infer missing biographical data.
 */
export type MemoryRecord = {
  id: string;
  title: string;
  content: string;
  category: string;
  domain: string;
  people: string[];
  entities: string[];
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
  confidence: MemoryConfidence;
  status: MemoryStatus;
  source: string;
  sourceFile: string;
  relationships: MemoryRelationship[];
  importance: number;
  accessCount: number;
  lastAccessedAt: string | null;
  validFrom?: string;
  validTo?: string;
  operation: MemoryOperation;
  supersedes: string[];
  uncertainty: string[];
  contentHash: string;
};

export type MemoryProvenance = {
  recordId: string;
  sourceFile: string;
  score: number;
  matchedEntities: string[];
  matchedTags: string[];
};

export type RetrievedMemory = {
  record: MemoryRecord;
  provenance: MemoryProvenance;
  estimatedCharacters: number;
};

export type MemoryRetrievalOptions = {
  topK: number;
  candidateLimit: number;
  maxCharacters: number;
  maxPerDomain: number;
  minimumScore: number;
};

export type MemoryCacheMetrics = {
  hits: number;
  misses: number;
  evictions: number;
  entries: number;
  estimatedBytes: number;
};

export type MemoryRetrievalReport = {
  query: string;
  retrieved: RetrievedMemory[];
  totalCharacters: number;
  cache: MemoryCacheMetrics;
  indexedRecords: number;
  indexedFiles: number;
  reindexedFiles: number;
  skippedFiles: number;
};
