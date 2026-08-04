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

## Embedding runtime lifecycle

KaiLore and coding embeddings use the shared provider-neutral `EmbeddingRuntimeManager`. A retrieval operation acquires a scoped lease keyed by domain, model, and revision; overlapping requests reuse the same residency and only the final release can schedule idle eviction. No embedding runtime is loaded at application startup.

The manager records ownership (`kai-managed`, `shared-ollama`, `user-managed-external`, or `unsupported`), lifecycle, refcount, last-use time, unload deadline, and the last health error. KaiLore defaults to a short 120-second idle retention. Coding defaults to 300 seconds and can remain warm across planner/implementer/reviewer transitions. Settings bound retention and can retain a runtime during indexing. Memory-pressure eviction only targets idle embedding leases and never active leases or unrelated model roles.

For shared Ollama models, load and unload operations are exact-tag scoped. Unload requests use Ollama's `keep_alive: 0` and never issue a broad runtime shutdown. External or unsupported runtimes are observed but never forcibly unloaded. Status is available through `/api/retrieval/status` and `/api/retrieval/runtime`.

Coding retrieval is deliberately burst-only during a coding job. It acquires a
coding-domain embedding lease for the bounded retrieval operation, supplies the
validated result to the active logical role, and releases the lease afterward.
Planner, implementer, and reviewer do not inherit KaiLore results or one
another's retrieval cache. Before coding begins, an idle KaiLore embedding may
be released only when its reference count is zero and Kai Studio owns an exact,
supported unload operation. Active and externally managed runtimes are left
untouched.
