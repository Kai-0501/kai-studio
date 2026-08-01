import type { CanonicalMessage, GenerateRequest, GenerateResult, ModelDefinition, ModelProvider } from "@/lib/models/types";
import { ModelRuntimeError } from "@/lib/models/types";

function text(message: CanonicalMessage) {
  return typeof message.content === "string" ? message.content : message.content.map((part) => part.type === "text" ? part.text : `[image:${part.mimeType ?? "unknown"}]`).join("\n");
}

export const openAiCompatibleProvider: ModelProvider = {
  id: "openai-compatible",
  async health(model, signal) {
    if (!model.endpoint) return false;
    try { return (await fetch(`${model.endpoint.replace(/\/$/, "")}/models`, { signal: signal ?? AbortSignal.timeout(3000) })).ok; } catch { return false; }
  },
  async generate(model: ModelDefinition, request: GenerateRequest): Promise<GenerateResult> {
    if (!model.endpoint) throw new ModelRuntimeError("The OpenAI-compatible model has no endpoint.", "configuration", "openai-compatible");
    const key = model.apiKeyEnv ? process.env[model.apiKeyEnv] : undefined;
    const started = performance.now();
    const response = await fetch(`${model.endpoint.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: model.providerModel, messages: request.messages.map((message) => ({ role: message.role, content: text(message) })), stream: false, temperature: request.temperature ?? model.defaultTemperature, max_tokens: request.maxTokens ?? 4096, ...(request.schema ? { response_format: { type: "json_schema", json_schema: { name: "kai_studio_response", schema: request.schema } } } : {}) }),
      signal: request.signal,
    });
    if (!response.ok) throw new ModelRuntimeError((await response.text()).slice(0, 2000), response.status === 401 ? "authentication" : response.status === 429 ? "rate-limit" : "provider", "openai-compatible");
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const message = payload.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).flatMap((call, index) => call.function?.name ? [{ id: call.id ?? `openai-${index}`, name: call.function.name, arguments: JSON.parse(call.function.arguments || "{}") as Record<string, unknown> }] : []);
    return { text: message?.content ?? "", toolCalls, usage: { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens }, latencyMs: performance.now() - started, modelId: model.id, provider: "openai-compatible" };
  },
};
