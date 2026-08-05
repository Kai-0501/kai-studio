import type { CanonicalMessage, GenerateRequest, GenerateResult, ImageGenerationRequest, ImageGenerationResult, ModelDefinition, ModelProvider } from "@/lib/models/types";
import { ModelRuntimeError } from "@/lib/models/types";

const endpoint = process.env.KAI_OLLAMA_URL ?? "http://127.0.0.1:11434";

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
};

function imageDataUrlToBase64(value: string) {
  if (!value.startsWith("data:")) return null;
  const separator = value.indexOf(",");
  if (separator === -1 || !value.slice(0, separator).toLowerCase().includes(";base64")) return null;
  const encoded = value.slice(separator + 1).trim();
  return encoded || null;
}

export function buildOllamaImageRequest(model: ModelDefinition, request: ImageGenerationRequest) {
  return {
    model: model.providerModel,
    prompt: request.prompt,
    n: 1,
    size: `${request.width}x${request.height}`,
    response_format: "b64_json",
    ...(request.seed === undefined ? {} : { seed: request.seed }),
  };
}

/**
 * Ollama's image models use the experimental OpenAI-compatible image endpoint,
 * not the text-generation endpoint. Read its non-streaming envelope exactly
 * once so an incomplete runtime response is reported accurately.
 */
export async function parseOllamaImageResponse(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const body = await response.text();
  const responseDetails = {
    httpStatus: response.status,
    contentType: contentType || "unknown",
    responseBytes: Buffer.byteLength(body),
    streamed: false,
  };

  if (!response.ok) {
    throw new ModelRuntimeError(
      `The local image runtime rejected the request (HTTP ${response.status}).`,
      normaliseStatus(response.status),
      "ollama",
      responseDetails,
    );
  }
  if (!body.trim()) {
    throw new ModelRuntimeError("The local image runtime returned an empty response.", "provider", "ollama", responseDetails);
  }
  if (!contentType.includes("application/json")) {
    throw new ModelRuntimeError("The local image runtime returned an unsupported response format.", "provider", "ollama", responseDetails);
  }

  let payload: OllamaImagePayload;
  try {
    payload = JSON.parse(body) as OllamaImagePayload;
  } catch {
    throw new ModelRuntimeError("The local image runtime returned an incomplete JSON response.", "provider", "ollama", { ...responseDetails, bodyComplete: false });
  }
  const base64 = payload.data?.[0]?.b64_json ?? payload.image;
  if (typeof base64 === "string" && base64.trim()) return base64;

  const url = payload.data?.[0]?.url;
  if (typeof url === "string") {
    const encoded = imageDataUrlToBase64(url);
    if (encoded) return encoded;
    throw new ModelRuntimeError(
      "The local image runtime returned an image URL instead of the requested base64 payload.",
      "provider",
      "ollama",
      { ...responseDetails, responseShape: "url" },
    );
  }
  if (typeof base64 !== "string" || !base64.trim()) {
    throw new ModelRuntimeError("The local image runtime returned no image data.", "provider", "ollama", responseDetails);
  }
  return base64;
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
    const signal = request.signal ?? AbortSignal.timeout(180_000);
    let response: Response;
    try {
      response = await fetch(`${endpoint}/v1/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOllamaImageRequest(model, request)),
        signal,
      });
    } catch {
      const aborted = signal.aborted;
      const timedOut = aborted && signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
      throw new ModelRuntimeError(
        timedOut ? "The local image runtime took too long to respond." : aborted ? "The image request was cancelled." : "The local image runtime could not be reached.",
        timedOut ? "timeout" : aborted ? "cancelled" : "unavailable",
        "ollama",
        { streamed: false, cancelState: aborted ? (timedOut ? "timeout" : "cancelled") : "not-cancelled" },
      );
    }
    const imageBase64 = await parseOllamaImageResponse(response);
    return { imageBase64, mimeType: "image/png", latencyMs: performance.now() - started, modelId: model.id, provider: "ollama" };
  },
};
