# Bounded Image Generation: Private Implementation Notes

## Scope

Normal Chat image mode is the only entry point for image generation. It does not expose a raw provider request or a quick-generation bypass.

## Role flow

`image.planner` creates a structured `VisualIntent`; `image.generator` receives only the provider-aware compiled brief; `vision.reviewer` evaluates the returned candidate. Each role resolves through the shared model registry and the user’s Settings assignment. The UI must display the resolved runtime model, not a component-local default.

## Persistence boundary

Generation records and image artifacts are stored locally in `.promptdeck`. Records contain the original request, structured intent, compiled prompts, validation evidence, candidate reviews, and selection state. They are deliberately excluded from source control. No generated image, user prompt, local artifact, runtime secret, or provider credential belongs in Git.

## Retry contract

The initial candidate plus at most two corrective candidates form one generation job. A retry is allowed only when a mandatory requirement fails. The corrective prompt preserves accepted constraints and targets only the failed mandatory requirement. Decorative differences never cause a retry. If vision review is unavailable, Settings determines whether Kai Studio returns a clearly unverified result or fails safely.

## Provider contract

Image-capable providers implement the central `generateImage` contract. The compiler reads the resolved provider’s capability profile before producing a prompt. Provider adapters own request transport and result normalisation; the Chat component must never name or call a provider directly.

For the current Ollama adapter, image generation uses the non-streaming
OpenAI-compatible image endpoint (`/v1/images/generations`) and expects an
image envelope containing `data[0].b64_json`. It must not route image jobs to
Ollama's text-generation endpoint. The adapter reads response text once before
parsing so empty, truncated, non-JSON, HTTP, timeout, and cancellation cases
remain distinguishable without storing private response content.

### Safe diagnostic fields

The pipeline may retain: request ID, pipeline stage, success/failure, elapsed
time, payload type and length, provider error class, HTTP status, content type,
response byte count, streaming mode, and cancellation state. It must not retain
raw prompts, image data, artifact paths, credentials, or raw provider errors in
the UI diagnostic payload.

## Operational checks

Before changing this pipeline, verify: structured-plan validation fails before provider invocation; generated records survive restart; the selected candidate has review evidence or an explicit unverified state; retries never exceed the configured maximum; and the generator, planner, and reviewer assignments resolve through the registry without a silent substitution.
