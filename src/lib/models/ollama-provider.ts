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

type OllamaImagePayload = {
  data?: Array<{ b64_json?: unknown; url?: unknown }>;
  image?: unknown;
};

export function buildOllamaImageRequest(model: ModelDefinition, request: ImageGenerationRequest) {
  return {
    model: model.providerModel,
    prompt: request.prompt,
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
  const image = payload.data?.[0]?.b64_json ?? payload.image;
  if (typeof image !== "string" || !image.trim()) {
    throw new ModelRuntimeError("The local image runtime returned no image data.", "provider", "ollama", responseDetails);
  }
  return image;
}

export const ollamaProvider: ModelProvider = {
  id: "ollama",
  async health(model, signal) {
    try {
      const response = await fetch(`${endpoint}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: model.providerModel }), signal: signal ?? AbortSignal.timeout(3000) });
      return response.ok;
    } catch { return false; }
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
