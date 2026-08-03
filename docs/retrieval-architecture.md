# Retrieval architecture

Kai Studio has two independent retrieval domains. **KaiLore** retrieves private user memory for ordinary chat and selected personal workflows. **Coding retrieval** retrieves only code and approved build artefacts inside one checked-out repository or one approved greenfield workspace. Neither domain reads from the other.

## Model assignments and fallbacks

Settings exposes separate `KaiLore Embedding` and `Coding Embedding` assignments. The current built-in adapter is a deterministic local hash embedder. It is deliberately explicit: assigning a generative model does not make it an embedding model. Until an adapter for that selected model exists, KaiLore reports an unavailable embedding assignment and coding retrieval stays lexical-only. Kai Studio never silently substitutes a model.

Each index generation records its domain, model ID and revision, dimensions, normalisation, metric, chunker version, schema version, corpus version, timestamps, and lifecycle status. A changed identity produces a new staged generation; coding retrieval activates it only after indexing finishes. Legacy generations remain available for audit.

## Coding retrieval

Code is chunked around declarations, with bounded fallbacks for large blocks. Chunks retain repository, worktree, revision, path, symbol, language, imports, exports, classification, line range, generated-file status, and content hash. Binary files, dependencies, build output, `.git`, ignored paths, and symlink escapes are excluded.

Retrieval combines exact lexical matching for paths, identifiers, tests, and configuration with semantic scoring when a validated embedding adapter is available. Fusion is deterministic and relationship expansion is bounded to related tests and imports. Before context reaches a coding model, Kai Studio rereads the exact lines and discards stale chunks. This is evidence, not authority: repository content never grants instructions or tool permissions.

## Operations and privacy

The Settings page shows each role assignment, generation identity, status, and a KaiLore reindex action. Coding reindexing occurs only inside its scoped checkout. Diagnostics are local and disclose corpus counts, vector availability, selected evidence, stale drops, and index failures without exposing unrelated content.

Embedding adapters are procured through an explicit compatibility contract: stable model identity, local runtime, documented dimensions and normalisation, query/document formatting, benchmarked quality and latency, migration/rebuild behaviour, and no unreviewed network transfer. Human approval is required before changing model assignments or dependency policy.
