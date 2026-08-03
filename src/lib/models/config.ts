import type { ModelDefinition, ModelRole, RoleRoute } from "@/lib/models/types";

const defaultModels: ModelDefinition[] = [
  { id: "local.memory-hash-embedding", displayName: "Local Memory Embeddings", provider: "openai-compatible", providerModel: "local-hash", capabilities: ["embedding"], contextWindow: 0, supportsTools: false, supportsStructuredOutput: false, supportsVision: false, supportsReasoning: false, defaultTemperature: 0, defaultContextAllocation: 0, enabled: true },
  { id: "local.qwen3.6-27b-coder", displayName: "Qwen 3.6 27B", provider: "ollama", providerModel: process.env.KAI_MODEL_QWEN_CODER ?? "qwen3.6:27b-mtp-q4_K_M", capabilities: ["chat", "coding", "tools", "structured-output"], contextWindow: 262144, supportsTools: true, supportsStructuredOutput: true, supportsVision: false, supportsReasoning: true, defaultTemperature: 0, defaultContextAllocation: 131072, enabled: true },
  { id: "local.gemma4-31b-security", displayName: "Gemma 4 31B", provider: "ollama", providerModel: process.env.KAI_MODEL_SECURITY ?? "gemma4:31b-mlx", capabilities: ["chat", "security-review", "repository-review", "structured-output", "reasoning"], contextWindow: 131072, supportsTools: false, supportsStructuredOutput: true, supportsVision: true, supportsReasoning: true, defaultTemperature: 0, defaultContextAllocation: 98304, enabled: true },
  { id: "local.gpt-oss-safeguard-20b", displayName: "GPT-OSS Safeguard 20B", provider: "ollama", providerModel: process.env.KAI_MODEL_SAFEGUARD ?? "gpt-oss-safeguard:20b", capabilities: ["chat", "security-review", "structured-output", "reasoning"], contextWindow: 131072, supportsTools: false, supportsStructuredOutput: true, supportsVision: false, supportsReasoning: true, defaultTemperature: 0, defaultContextAllocation: 98304, enabled: true },
  { id: "local.gemma4-12b-editor", displayName: "Gemma 4 12B", provider: "ollama", providerModel: process.env.KAI_MODEL_EDITORIAL ?? "gemma4:12b-mlx", capabilities: ["chat", "editorial", "structured-output"], contextWindow: 131072, supportsTools: false, supportsStructuredOutput: true, supportsVision: true, supportsReasoning: false, defaultTemperature: 0.2, defaultContextAllocation: 65536, enabled: true },
  { id: "local.gemma4-26b-chat", displayName: "Gemma 4 26B", provider: "ollama", providerModel: "gemma4:26b-mlx", capabilities: ["chat", "reasoning", "vision"], contextWindow: 131072, supportsTools: false, supportsStructuredOutput: false, supportsVision: true, supportsReasoning: true, defaultTemperature: 0.2, defaultContextAllocation: 65536, enabled: true },
  { id: "local.glm-ocr", displayName: "Local Image Reader", provider: "ollama", providerModel: "glm-ocr", capabilities: ["chat", "vision"], contextWindow: 32768, supportsTools: false, supportsStructuredOutput: false, supportsVision: true, supportsReasoning: false, defaultTemperature: 0, defaultContextAllocation: 16384, enabled: true },
  { id: "cloud.gemini-orchestrator", displayName: "Cloud Orchestrator", provider: "gemini", providerModel: process.env.KAI_GEMINI_MODEL ?? "gemini-2.5-pro", apiKeyEnv: "GEMINI_API_KEY", capabilities: ["chat", "orchestration", "structured-output", "reasoning"], contextWindow: 1048576, supportsTools: true, supportsStructuredOutput: true, supportsVision: true, supportsReasoning: true, defaultTemperature: 0.2, defaultContextAllocation: 262144, enabled: Boolean(process.env.GEMINI_API_KEY) },
];

const defaultRoutes: Record<ModelRole, RoleRoute> = {
  "coder.primary": { primary: "local.qwen3.6-27b-coder", requiredCapabilities: ["coding", "tools", "structured-output"], localOnly: true },
  "security.preflight": { primary: "local.gpt-oss-safeguard-20b", fallbacks: ["local.gemma4-31b-security"], requiredCapabilities: ["security-review", "structured-output"], localOnly: true },
  "security.postflight": { primary: "local.gemma4-31b-security", requiredCapabilities: ["repository-review", "structured-output"], localOnly: true },
  "editorial.primary": { primary: "local.gemma4-12b-editor", requiredCapabilities: ["editorial"], localOnly: true },
  "orchestrator.cloud": { primary: "cloud.gemini-orchestrator", requiredCapabilities: ["orchestration"] },
  "chat.default": { primary: "local.gemma4-26b-chat", fallbacks: ["local.gemma4-31b-security", "local.gemma4-12b-editor"], requiredCapabilities: ["chat"], localOnly: true },
  "vision.extractor": { primary: "local.glm-ocr", requiredCapabilities: ["vision"], localOnly: true },
  "diagnostics.primary": { primary: "local.gemma4-31b-security", requiredCapabilities: ["chat", "reasoning"], localOnly: true },
  "diagnostics.parser": { primary: "local.gemma4-12b-editor", requiredCapabilities: ["chat", "structured-output"], localOnly: true },
  "progress.assessor": { primary: "local.gemma4-12b-editor", requiredCapabilities: ["chat", "structured-output"], localOnly: true },
  "review.primary": { primary: "local.gemma4-31b-security", requiredCapabilities: ["repository-review", "structured-output"], localOnly: true },
  "memory.embedding": { primary: "local.memory-hash-embedding", requiredCapabilities: ["embedding"], localOnly: true },
};

function configuredModels() {
  if (!process.env.KAI_MODEL_REGISTRY_JSON) return defaultModels;
  const overrides = JSON.parse(process.env.KAI_MODEL_REGISTRY_JSON) as ModelDefinition[];
  return overrides;
}

function configuredRoutes() {
  if (!process.env.KAI_MODEL_ROUTES_JSON) return defaultRoutes;
  return { ...defaultRoutes, ...(JSON.parse(process.env.KAI_MODEL_ROUTES_JSON) as Partial<Record<ModelRole, RoleRoute>>) };
}

export const modelRegistry = new Map(configuredModels().map((model) => [model.id, model]));
export const roleRoutes = configuredRoutes();
