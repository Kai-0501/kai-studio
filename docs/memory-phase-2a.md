# Local memory Phase 2A

The local memory system has a pluggable local embedding boundary. The default provider is a
deterministic local hash embedding so the application remains offline and does
not require a model server. Records keep their sparse/FTS representation and a
dense vector in the local SQLite index; retrieval blends lexical, entity, tag,
recency, and dense cosine scores under the existing character budget.

The `EmbeddingProvider` interface in `src/lib/memory/embeddings.ts` is the
replacement seam for a real local embedding model. A future provider can be
selected through the model registry's `memory.embedding` role without changing
the index or retriever. If dense memory is disabled or a provider fails, the
retriever falls back to sparse/FTS search rather than blocking chat.

Coding jobs use the same bounded-memory principles without importing the user's
personal corpus: hot tool evidence is capped, warm checkpoints summarize
verified progress, and the complete cold event log remains available through a
bounded retrieval method. This limits KV/context growth while preserving files,
checks, blockers, provenance, and resumability.
