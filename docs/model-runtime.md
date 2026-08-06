# Model runtime

Kai Studio routes work by **role and capability**, not by embedding model names
throughout the product. The canonical request and response types live in
`src/lib/models/types.ts`; provider adapters translate those types into each
backend's protocol.

## Providers

- Ollama for locally managed models.
- Kai Studio-managed llama.cpp for validated GGUF models, plus MLX candidates
  discovered from approved folders. MLX candidates remain clearly marked until
  a compatible managed runtime is available.
- Gemini for optional cloud orchestration jobs.

Cloud routes are opt-in. Chat, security review, coding, editorial work, vision,
and diagnostics are local-only by default.

## Roles

The registry currently defines these stable roles:

- `chat.default`
- `coder.primary`
- `security.preflight`
- `security.postflight`
- `editorial.primary`
- `vision.extractor`
- `diagnostics.primary`
- `diagnostics.parser`
- `progress.assessor`
- `orchestration.primary`
- `review.primary`
- `orchestrator.cloud`

Settings store user-selected provider model identifiers for each user-facing
assignment. Runtime resolution combines that selection with the role's required
capabilities and refuses unavailable or incompatible providers. This lets a new
model inherit an existing workflow's plumbing without rewriting the workflow.

Human-facing role descriptions live in `src/lib/models/roles.ts`. Settings
reuses that metadata for its accessible help controls instead of duplicating
role prose across screens.

## Discovery

The system-status API combines Ollama with candidate models found only in
approved roots: `~/Models`, Kai Studio-managed folders, the standard Hugging
Face cache, and explicit folders registered in Settings. It never scans the
entire home directory, follows symlink escapes, or runs instructions from model
cards and READMEs. Discovery is incremental and does not load large weights.

Discovery and availability are separate. A candidate exposes only filesystem
and manifest evidence; a GGUF model becomes available after the user explicitly
validates it through Kai Studio's bounded llama.cpp launch check. The UI keeps
unavailable assignments intact, explains the warning, and never silently
substitutes another model.

User-managed files are never moved, copied, converted, or deleted.

## Failure boundary

Provider errors are normalized into configuration, capability, availability,
authentication, rate-limit, timeout, cancellation, or provider failures.
Inference telemetry records the selected role, provider, latency, usage, tool
calls, fallbacks, and outcome without storing API keys.

## Generative residency lifecycle

All local generation passes through the provider-neutral
`GenerativeRuntimeManager`. A lease is keyed by the resolved provider model,
not by a UI component. The manager records lifecycle state, ownership,
reference count, active roles, workflows, jobs and sessions, estimated resident
bytes, last use, unload deadline, and health errors.

Overlapping leases for one model share one load. Nested calls from the coding
workflow therefore reuse the coding job's outer lease. Different model IDs
remain independent residencies. Only a zero-reference `kai-managed` runtime
with an explicit unload adapter may be released; a model already resident
before Kai Studio acquired it is treated as user-managed external state and is
never forcibly unloaded. Ollama operations are exact-tag scoped and do not stop
the server or unload unrelated models.

The coding workflow keeps one configured coding model resident while planner,
implementer, and reviewer take sequential turns. Their application checkpoints
are private and reconstructable, so model weights can remain shared without
sharing agent KV/session state. Stop-for-review releases the model lease while
preserving job checkpoints and repository state.

Runtime state is exposed through the coding runtime status endpoint and the
Settings observability panel. Model assignment, actual resolved model,
ownership, references, resident state, memory-pressure fallback, and pending
idle eviction remain visible. Kai Studio never performs a hidden provider or
model substitution.
