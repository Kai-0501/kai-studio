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
image envelope containing `data[0].b64_json` (or a base64 data URL when
explicitly provided). A non-base64 URL is rejected rather than being mistaken
for image bytes. It must not route image jobs to Ollama's
text-generation endpoint. Image-only models also own their initial load and
release through the native image runtime: the shared text-model residency
manager records their lease but must never pre-warm or unload them through
`/api/generate`. The adapter reads response text once before
parsing so empty, truncated, non-JSON, HTTP, timeout, and cancellation cases
remain distinguishable without storing private response content.

### Runtime finding, August 2026

The active local runtime for `x/z-image-turbo:latest` is Ollama's native
image-generation runner, not a separate ComfyUI, Diffusers, or MLX server.
The model is image-only, and its valid request contract is the Ollama
OpenAI-compatible `POST /v1/images/generations` route with one request per
candidate. Earlier shared-residency behaviour treated every Ollama model as a
text model and sent a blank `/api/generate` warm-up. That was an invalid
transport assumption for image-only models and could surface as a generic
provider-request failure even when Ollama's image runner was healthy.

The corrected boundary is deliberately small: the image provider performs the
single native image request, while shared residency tracks the lease without
issuing text warm-up or text unload calls. Failure taxonomy now retains the
safe runtime category (`timeout`, `unavailable`, `capability`,
`configuration`, or `provider`) and provides a recoverable user action.

### Safe diagnostic fields

The pipeline may retain: request ID, pipeline stage, success/failure, elapsed
time, payload type and length, provider error class, HTTP status, content type,
response byte count, streaming mode, and cancellation state. It must not retain
raw prompts, image data, artifact paths, credentials, or raw provider errors in
the UI diagnostic payload.

## Operational checks

Before changing this pipeline, verify: structured-plan validation fails before provider invocation; generated records survive restart; the selected candidate has review evidence or an explicit unverified state; retries never exceed the configured maximum; and the generator, planner, and reviewer assignments resolve through the registry without a silent substitution.
