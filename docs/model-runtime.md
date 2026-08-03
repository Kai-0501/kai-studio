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
