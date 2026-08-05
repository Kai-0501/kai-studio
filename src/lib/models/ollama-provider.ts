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
    let response: Response;
    try {
      response = await fetch(`${endpoint}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: model.providerModel, prompt: request.prompt, stream: false, options: { width: request.width, height: request.height, ...(request.seed === undefined ? {} : { seed: request.seed }) } }), signal: request.signal ?? AbortSignal.timeout(180_000) });
    } catch (error) {
      throw new ModelRuntimeError(error instanceof Error ? error.message : "The local image provider could not be reached.", request.signal?.aborted ? "cancelled" : "unavailable", "ollama");
    }
    if (!response.ok) throw new ModelRuntimeError((await response.text()).slice(0, 2000) || "The local image provider failed.", normaliseStatus(response.status), "ollama");
    const payload = await response.json() as { image?: string };
    if (!payload.image) throw new ModelRuntimeError("The local image provider returned no image.", "provider", "ollama");
    return { imageBase64: payload.image, mimeType: "image/png", latencyMs: performance.now() - started, modelId: model.id, provider: "ollama" };
  },
};
