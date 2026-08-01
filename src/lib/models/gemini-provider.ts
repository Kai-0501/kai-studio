import type { CanonicalMessage, GenerateRequest, GenerateResult, ModelDefinition, ModelProvider } from "@/lib/models/types";
import { ModelRuntimeError } from "@/lib/models/types";

function text(message: CanonicalMessage) {
  return typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join("\n");
}

export const geminiProvider: ModelProvider = {
  id: "gemini",
  async health(model) { return model.enabled && Boolean(model.apiKeyEnv && process.env[model.apiKeyEnv]); },
  async generate(model: ModelDefinition, request: GenerateRequest): Promise<GenerateResult> {
    const apiKey = model.apiKeyEnv ? process.env[model.apiKeyEnv] : undefined;
    if (!apiKey) throw new ModelRuntimeError("The cloud model credential is unavailable.", "authentication", "gemini");
    const started = performance.now();
    const system = request.messages.filter((message) => message.role === "system").map(text).join("\n\n");
    const contents = request.messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: text(message) }] }));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.providerModel)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
      body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents, generationConfig: { temperature: request.temperature ?? model.defaultTemperature, maxOutputTokens: request.maxTokens ?? 4096, ...(request.schema ? { responseMimeType: "application/json", responseSchema: request.schema } : {}) } }),
    });
    if (!response.ok) throw new ModelRuntimeError((await response.text()).slice(0, 2000), response.status === 401 || response.status === 403 ? "authentication" : response.status === 429 ? "rate-limit" : "provider", "gemini");
    const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    return { text: payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "", toolCalls: [], usage: { inputTokens: payload.usageMetadata?.promptTokenCount, outputTokens: payload.usageMetadata?.candidatesTokenCount }, latencyMs: performance.now() - started, modelId: model.id, provider: "gemini" };
  },
};
