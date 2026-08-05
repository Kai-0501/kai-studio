# Bounded image generation

Kai Studio has one image-generation path. A direct request is never sent straight
to an image provider. The current model assignment determines the planner,
generator, and vision-reviewer roles; the interface does not hard-code a model
or provider name.

```text
User request
  → visual-intent planner (strict JSON)
  → deterministic brief validation
  → provider-aware prompt compiler
  → configured image generator
  → configured vision reviewer
  → select best candidate or correct bounded gaps (maximum two retries)
```

## Boundaries

- The planner returns a typed visual brief, not hidden reasoning.
- Mandatory requirements and forbidden elements are checked before generation.
- The reviewer evaluates only visible evidence and preserves uncertainty.
- Retry is reserved for failed mandatory requirements, forbidden elements, or an
  explicitly enabled preferred-requirement policy.
- At most three candidates are created for one request.
- If review is unavailable, Settings determines whether Kai Studio returns a
  clearly labelled unverified image or fails safely.
- Every attempt records its provider, model, compiled instruction, artifact,
  review, and selection decision locally. Attempt history is kept outside Git.

## Provider neutrality

Provider-specific dimensions and capability limits belong in a capability profile
behind the model runtime. Components request roles (`image.planner`,
`image.generator`, and `vision.reviewer`) from the central registry. Replacing a
model in Settings preserves these stages and does not create a quick-generation
bypass.

## Image-runtime transport

An image-capable runtime receives a single non-streaming, provider-compatible
image request and returns a normalised image envelope. Kai Studio reads that
response once, validates its content type and image payload, and records only
safe operational metadata (request ID, stage, elapsed time, response class, and
payload size). It never exposes prompts, image bytes, local paths, or runtime
credentials in diagnostic UI.

If generation succeeds but vision review fails, the candidate image is retained
as **unverified** according to the configured review policy. A runtime failure
is shown as a concise user message with optional technical details instead of a
raw provider error.

## Human controls

The normal chat surface shows only progress and the selected result. An optional
**Generation details** panel exposes the visual brief, attempts, review scores,
and status. Settings controls review, retry count, confidence threshold,
preferred-requirement policy, persistence, and review-unavailable behaviour.
