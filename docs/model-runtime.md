# Model runtime

Kai Studio routes work by **role and capability**, not by embedding model names
throughout the product. The canonical request and response types live in
`src/lib/models/types.ts`; provider adapters translate those types into each
backend's protocol.

## Providers

- Ollama for locally managed models.
- OpenAI-compatible endpoints for Kai Studio-managed llama.cpp and downloaded
  Hugging Face models.
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

## Discovery

The system-status API combines Ollama's installed-model list with compatible
Hugging Face model directories discovered on the Mac. The interface uses that
inventory for chat and assignment selectors. A Hugging Face selection is
started through Kai Studio's managed local runtime when first needed, so a
terminal server does not need to remain open.

## Failure boundary

Provider errors are normalized into configuration, capability, availability,
authentication, rate-limit, timeout, cancellation, or provider failures.
Inference telemetry records the selected role, provider, latency, usage, tool
calls, fallbacks, and outcome without storing API keys.
