import type { CanonicalMessage, GenerateRequest, GenerateResult, ImageGenerationRequest, ImageGenerationResult, ModelDefinition, ModelProvider } from "@/lib/models/types";
import { ModelRuntimeError } from "@/lib/models/types";

const endpoint = process.env.KAI_OLLAMA_URL ?? "http://127.0.0.1:11434";
// Native diffusion can take several minutes on a cold load or a dense scene.
// Keep this bounded, but do not cancel an in-progress Ollama image runner at
// the generic text-request threshold.
const OLLAMA_IMAGE_REQUEST_TIMEOUT_MS = 480_000;

function content(message: CanonicalMessage) {
  if (typeof message.content === "string") return { role: message.role, content: message.content };
  return {
    role: message.role,
    content: message.content.filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join("\n"),
    images: message.content.filter((part) => part.type === "image").map((part) => part.type === "image" ? part.data : ""),
  };
}

function normaliseStatus(status: number) {
  if (status === 401 || status === 403) return "authentication" as const;
  if (status === 429) return "rate-limit" as const;
  if (status === 404 || status === 503) return "unavailable" as const;
  return "provider" as const;
}

async function readJson(response: Response) {
  try { return await response.json() as Record<string, unknown>; } catch { return {}; }
}

/**
 * Validates Ollama's documented image contract without generating an image.
 * `/api/show` confirms the installed model exposes the image capability;
 * OPTIONS confirms the native OpenAI-compatible image route is present.
 */
export async function validateOllamaImageRuntime(model: ModelDefinition, signal?: AbortSignal, request: typeof fetch = fetch): Promise<void> {
  let modelResponse: Response;
  try {
    modelResponse = await request(`${endpoint}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.providerModel }),
      signal: signal ?? AbortSignal.timeout(4_000),
    });
  } catch {
    throw new ModelRuntimeError("The local Ollama runtime is not available.", "unavailable", "ollama", { operation: "model-validation" });
  }
  if (!modelResponse.ok) {
    const details = await readJson(modelResponse);
    const category = modelResponse.status === 404 ? "unavailable" : normaliseStatus(modelResponse.status);
    throw new ModelRuntimeError(
      modelResponse.status === 404 ? "The configured image model was not found in Ollama." : "Ollama could not validate the configured image model.",
      category,
      "ollama",
      { operation: "model-validation", httpStatus: modelResponse.status, responseError: typeof details.error === "string" ? details.error.slice(0, 120) : undefined },
    );
  }
  const modelMetadata = await readJson(modelResponse);
  const capabilities = Array.isArray(modelMetadata.capabilities) ? modelMetadata.capabilities : [];
  if (!capabilities.includes("image")) {
    throw new ModelRuntimeError("The configured Ollama model does not expose image-generation capability.", "capability", "ollama", { operation: "model-capabilities" });
  }

  let routeResponse: Response;
  try {
    routeResponse = await request(`${endpoint}/v1/images/generations`, { method: "OPTIONS", signal: signal ?? AbortSignal.timeout(4_000) });
  } catch {
    throw new ModelRuntimeError("Ollama's image-generation endpoint is not reachable.", "unavailable", "ollama", { operation: "image-route-validation" });
  }
  // Ollama returns 405 with Allow: POST on versions that expose the route.
  if (![200, 204, 405].includes(routeResponse.status)) {
    const category = routeResponse.status === 404 ? "capability" : normaliseStatus(routeResponse.status);
    throw new ModelRuntimeError(
      routeResponse.status === 404 ? "This Ollama runtime does not expose image generation." : "Ollama's image-generation endpoint could not be validated.",
      category,
      "ollama",
      { operation: "image-route-validation", httpStatus: routeResponse.status },
    );
  }
}

type OllamaImagePayload = {
  data?: Array<{ b64_json?: unknown; url?: unknown }>;
  image?: unknown;
  error?: unknown;
  message?: unknown;
  done?: unknown;
  object?: unknown;
};

type OllamaImageNdjsonEvent = OllamaImagePayload & {
  created?: unknown;
  model?: unknown;
  usage?: unknown;
};

const MAX_IMAGE_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_NDJSON_LINE_BYTES = 11 * 1024 * 1024;

type SafeImageRequestMetadata = Record<string, string | number | boolean | undefined>;

function redactProviderErrorBody(body: string) {
  const compact = body.replace(/\s+/g, " ").trim();
  let candidate = compact;
  try {
    const parsed = JSON.parse(compact) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string") candidate = parsed.error;
    else if (typeof parsed.message === "string") candidate = parsed.message;
  } catch {
    // Keep the provider's plain-text error only after the conservative redaction below.
  }
  return candidate
    .replace(/\b(Bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 240) || undefined;
}

export function describeOllamaImageRequest(body: Record<string, unknown>): SafeImageRequestMetadata {
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const negativePrompt = typeof body.negative_prompt === "string" ? body.negative_prompt : "";
  const optionalFields = Object.keys(body).filter((field) => !["model", "prompt", "n", "size", "response_format"].includes(field));
  return {
    requestBodyBytes: Buffer.byteLength(JSON.stringify(body)),
    requestFields: Object.keys(body).sort().join(","),
    promptLength: prompt.length,
    negativePromptLength: negativePrompt.length,
    dimensions: typeof body.size === "string" ? body.size : undefined,
    providerModel: typeof body.model === "string" ? body.model : undefined,
    optionalParameters: optionalFields.join(",") || "none",
  };
}

function imageDataUrlToBase64(value: string) {
  if (!value.startsWith("data:")) return null;
  const separator = value.indexOf(",");
  if (separator === -1 || !value.slice(0, separator).toLowerCase().includes(";base64")) return null;
  const encoded = value.slice(separator + 1).trim();
  return encoded || null;
}

function imageSignature(buffer: Buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function validateImageBase64(base64: string, details: Record<string, string | number | boolean | undefined>) {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    throw new ModelRuntimeError("The local image runtime returned invalid base64 image data.", "artifact-validation", "ollama", details);
  }
  if (!buffer.length || !imageSignature(buffer)) {
    throw new ModelRuntimeError("The local image runtime returned data that is not a supported image artefact.", "artifact-validation", "ollama", { ...details, imagePayloadBytes: buffer.length });
  }
  return base64;
}

function extractImageBase64(payload: OllamaImagePayload) {
  const base64 = payload.data?.[0]?.b64_json ?? payload.image;
  if (typeof base64 === "string" && base64.trim()) return base64.trim();
  const url = payload.data?.[0]?.url;
  if (typeof url === "string") {
    const encoded = imageDataUrlToBase64(url);
    if (encoded) return encoded;
    if (url.trim()) return "external-url" as const;
  }
  return null;
}

function explicitProviderError(event: OllamaImageNdjsonEvent) {
  const candidate = event.error ?? event.message;
  return typeof candidate === "string" && candidate.trim() ? redactProviderErrorBody(candidate) : undefined;
}

function isNdjsonContentType(contentType: string) {
  return contentType.includes("application/x-ndjson") || contentType.includes("application/ndjson") || contentType.includes("application/jsonl");
}

function classifyNdjsonEvent(event: OllamaImageNdjsonEvent) {
  if (explicitProviderError(event)) return "terminal-error" as const;
  if (extractImageBase64(event)) return "final-image" as const;
  if (event.done === true) return "terminal-success" as const;
  if (event.object === "image.chunk" || event.object === "image.progress" || event.object === "image.generation") return "progress" as const;
  if (event.model !== undefined || event.created !== undefined || event.usage !== undefined) return "metadata" as const;
  return "unknown" as const;
}

function supportedImageFromPayload(payload: OllamaImagePayload, details: Record<string, string | number | boolean | undefined>) {
  const image = extractImageBase64(payload);
  if (image === "external-url") {
    throw new ModelRuntimeError("The local image runtime returned an image URL instead of the requested base64 payload.", "response-decode", "ollama", { ...details, responseShape: "url" });
  }
  if (!image) return null;
  return validateImageBase64(image, details);
}

function responseDetails(response: Response, bodyBytes: number, contentType: string) {
  return { httpStatus: response.status, contentType: contentType || "unknown", responseBytes: bodyBytes, streamed: isNdjsonContentType(contentType) };
}

function parseSingleJsonImageResponse(body: string, details: Record<string, string | number | boolean | undefined>) {
  let payload: OllamaImagePayload;
  try {
    payload = JSON.parse(body) as OllamaImagePayload;
  } catch {
    throw new ModelRuntimeError("The local image runtime returned an incomplete JSON response.", "response-decode", "ollama", { ...details, bodyComplete: false, finalDecodeStage: "json-envelope" });
  }
  const declaredError = explicitProviderError(payload);
  if (declaredError) throw new ModelRuntimeError("The local image runtime reported an error after accepting the request.", "provider-declared", "ollama", { ...details, responseError: declaredError, finalDecodeStage: "json-envelope" });
  const image = supportedImageFromPayload(payload, { ...details, eventCount: 1, parsedEventCount: 1, terminalEventType: "final-image", finalDecodeStage: "json-envelope" });
  if (!image) throw new ModelRuntimeError("The local image runtime returned no image data.", "missing-image", "ollama", { ...details, eventCount: 1, parsedEventCount: 1, finalDecodeStage: "json-envelope" });
  return image;
}

function parseNdjsonImageResponse(body: string, details: Record<string, string | number | boolean | undefined>) {
  const lines = body.split(/\r?\n/);
  let parsedEventCount = 0;
  let finalImage: string | null = null;
  let finalImageLine = 0;
  let terminalEventType = "none";
  const eventTypes: Record<string, number> = {};
  let ignoredTrailingMalformedLine: number | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const lineNumber = index + 1;
    const lineBytes = Buffer.byteLength(line);
    if (lineBytes > MAX_IMAGE_NDJSON_LINE_BYTES) {
      throw new ModelRuntimeError("The local image runtime returned an image stream line that exceeds the safe decoder limit.", "response-decode", "ollama", { ...details, eventCount: parsedEventCount, parsedEventCount, malformedLineNumber: lineNumber, finalDecodeStage: "ndjson-line-size" });
    }
    let event: OllamaImageNdjsonEvent;
    try {
      event = JSON.parse(line) as OllamaImageNdjsonEvent;
    } catch {
      if (finalImage) {
        ignoredTrailingMalformedLine = lineNumber;
        break;
      }
      throw new ModelRuntimeError("The local image runtime returned malformed NDJSON before an image result was available.", "response-decode", "ollama", { ...details, eventCount: parsedEventCount, parsedEventCount, malformedLineNumber: lineNumber, finalDecodeStage: "ndjson-parse" });
    }
    parsedEventCount += 1;
    const eventType = classifyNdjsonEvent(event);
    eventTypes[eventType] = (eventTypes[eventType] ?? 0) + 1;
    terminalEventType = eventType;
    const declaredError = explicitProviderError(event);
    if (declaredError) throw new ModelRuntimeError("The local image runtime reported an error after accepting the request.", "provider-declared", "ollama", { ...details, eventCount: parsedEventCount, parsedEventCount, terminalEventType: eventType, responseError: declaredError, finalDecodeStage: "ndjson-terminal-error" });
    const extracted = supportedImageFromPayload(event, { ...details, eventCount: parsedEventCount, parsedEventCount, terminalEventType: eventType, finalDecodeStage: "ndjson-image" });
    if (extracted) {
      finalImage = extracted;
      finalImageLine = lineNumber;
    }
  }

  const diagnostics = {
    ...details,
    eventCount: parsedEventCount,
    parsedEventCount,
    eventTypeCounts: Object.entries(eventTypes).map(([type, count]) => `${type}:${count}`).join(",") || "none",
    terminalEventType,
    imageEventFound: Boolean(finalImage),
    imageEventLine: finalImageLine || undefined,
    malformedTrailingLineNumber: ignoredTrailingMalformedLine,
    finalDecodeStage: finalImage ? "ndjson-final-image" : "ndjson-complete",
  };
  if (!finalImage) throw new ModelRuntimeError("The local image runtime completed its stream without an image result.", "missing-image", "ollama", diagnostics);
  return finalImage;
}

export function buildOllamaImageRequest(model: ModelDefinition, request: ImageGenerationRequest) {
  return {
    model: model.providerModel,
    prompt: request.prompt,
    n: 1,
    size: `${request.width}x${request.height}`,
    response_format: "b64_json",
  };
}

/**
 * Ollama's image models use the experimental OpenAI-compatible image endpoint,
 * not the text-generation endpoint. This route may reply with a single JSON
 * envelope, NDJSON progress events, or a binary image. Each response body is
 * consumed exactly once and NDJSON is parsed line-by-line.
 */
export async function parseOllamaImageResponse(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.startsWith("image/")) {
    const binary = Buffer.from(await response.arrayBuffer());
    const details = responseDetails(response, binary.length, contentType);
    if (!response.ok) throw new ModelRuntimeError(`The local image runtime rejected the request (HTTP ${response.status}).`, normaliseStatus(response.status), "ollama", details);
    if (binary.length > MAX_IMAGE_RESPONSE_BYTES) throw new ModelRuntimeError("The local image runtime returned an image artefact that exceeds the safe decoder limit.", "artifact-validation", "ollama", details);
    if (!imageSignature(binary)) throw new ModelRuntimeError("The local image runtime returned an unsupported binary image artefact.", "artifact-validation", "ollama", details);
    return binary.toString("base64");
  }

  const body = await response.text();
  const bodyBytes = Buffer.byteLength(body);
  const details = responseDetails(response, bodyBytes, contentType);

  if (!response.ok) {
    throw new ModelRuntimeError(
      `The local image runtime rejected the request (HTTP ${response.status}).`,
      normaliseStatus(response.status),
      "ollama",
      { ...details, responseError: redactProviderErrorBody(body) },
    );
  }
  if (bodyBytes > MAX_IMAGE_RESPONSE_BYTES) throw new ModelRuntimeError("The local image runtime returned a response that exceeds the safe decoder limit.", "response-decode", "ollama", details);
  if (!body.trim()) {
    throw new ModelRuntimeError("The local image runtime returned an empty response.", "missing-image", "ollama", details);
  }
  if (isNdjsonContentType(contentType)) return parseNdjsonImageResponse(body, details);
  if (contentType.includes("application/json")) return parseSingleJsonImageResponse(body, details);
  throw new ModelRuntimeError("The local image runtime returned an unsupported response format.", "response-decode", "ollama", details);
}

export const ollamaProvider: ModelProvider = {
  id: "ollama",
  async health(model, signal) {
    try {
      const response = await fetch(`${endpoint}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: model.providerModel }), signal: signal ?? AbortSignal.timeout(3000) });
      return response.ok;
    } catch { return false; }
  },
  async validateImageRuntime(model, signal) {
    await validateOllamaImageRuntime(model, signal);
  },
  async generate(model: ModelDefinition, request: GenerateRequest): Promise<GenerateResult> {
    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(`${endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.providerModel,
          stream: false,
          think: request.reasoning === "enabled" ? true : request.reasoning === "disabled" ? false : undefined,
          messages: request.messages.map(content),
          ...(request.schema && model.supportsStructuredOutput ? { format: request.schema } : {}),
          options: { temperature: request.temperature ?? model.defaultTemperature, num_predict: request.maxTokens ?? 4096, num_ctx: Math.min(model.contextWindow, model.defaultContextAllocation) },
        }),
        signal: request.signal,
      });
    } catch (error) {
      if (request.signal?.aborted) throw new ModelRuntimeError("The model request was cancelled.", "cancelled", "ollama");
      throw new ModelRuntimeError(error instanceof Error ? error.message : "The local model request failed.", "unavailable", "ollama");
    }
    if (!response.ok) throw new ModelRuntimeError((await response.text()).slice(0, 2000) || "The local model failed.", normaliseStatus(response.status), "ollama");
    const payload = (await response.json()) as { message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }> }; prompt_eval_count?: number; eval_count?: number };
    const text = payload.message?.content ?? "";
    const toolCalls = (payload.message?.tool_calls ?? []).flatMap((call, index) => call.function?.name ? [{ id: `ollama-${index}`, name: call.function.name, arguments: call.function.arguments ?? {} }] : []);
    if (!text && !toolCalls.length) throw new ModelRuntimeError("The local model returned an empty response.", "provider", "ollama");
    return { text, toolCalls, usage: { inputTokens: payload.prompt_eval_count, outputTokens: payload.eval_count }, latencyMs: performance.now() - started, modelId: model.id, provider: "ollama" };
  },
  async generateImage(model: ModelDefinition, request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const started = performance.now();
    const signal = request.signal ?? AbortSignal.timeout(OLLAMA_IMAGE_REQUEST_TIMEOUT_MS);
    let response: Response;
    const body = buildOllamaImageRequest(model, request);
    const requestDetails = describeOllamaImageRequest(body);
    try {
      response = await fetch(`${endpoint}/v1/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      const aborted = signal.aborted;
      const timedOut = aborted && signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
      throw new ModelRuntimeError(
        timedOut ? "The local image runtime took too long to respond." : aborted ? "The image request was cancelled." : "The local image runtime could not be reached.",
        timedOut ? "timeout" : aborted ? "cancelled" : "provider-transport",
        "ollama",
        { ...requestDetails, streamed: false, providerTimeoutMs: OLLAMA_IMAGE_REQUEST_TIMEOUT_MS, cancelState: aborted ? (timedOut ? "timeout" : "cancelled") : "not-cancelled" },
      );
    }
    let imageBase64: string;
    try {
      imageBase64 = await parseOllamaImageResponse(response);
    } catch (error) {
      if (error instanceof ModelRuntimeError) {
        throw new ModelRuntimeError(error.message, error.category, error.provider, { ...requestDetails, ...error.details });
      }
      throw error;
    }
    return { imageBase64, mimeType: "image/png", latencyMs: performance.now() - started, modelId: model.id, provider: "ollama" };
  },
};
