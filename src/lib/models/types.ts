export type ModelProviderId = "ollama" | "openai-compatible" | "gemini";

export type ModelCapability =
  | "chat"
  | "coding"
  | "security-review"
  | "editorial"
  | "orchestration"
  | "repository-review"
  | "structured-output"
  | "tools"
  | "vision"
  | "reasoning";

export type ModelRole =
  | "coder.primary"
  | "security.preflight"
  | "security.postflight"
  | "editorial.primary"
  | "orchestrator.cloud"
  | "chat.default"
  | "vision.extractor"
  | "diagnostics.primary"
  | "diagnostics.parser"
  | "review.primary";

export type CanonicalImage = { type: "image"; data: string; mimeType?: string };
export type CanonicalText = { type: "text"; text: string };
export type CanonicalContent = CanonicalText | CanonicalImage;

export type CanonicalToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type CanonicalToolResult = {
  callId: string;
  name: string;
  result?: unknown;
  error?: { category: string; message: string };
  attachments?: CanonicalImage[];
  metadata?: Record<string, string | number | boolean>;
};

export type CanonicalMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | CanonicalContent[];
  toolCalls?: CanonicalToolCall[];
  toolResult?: CanonicalToolResult;
  metadata?: { inputTokens?: number; outputTokens?: number; latencyMs?: number };
};

export type ModelDefinition = {
  id: string;
  displayName: string;
  provider: ModelProviderId;
  providerModel: string;
  endpoint?: string;
  apiKeyEnv?: string;
  capabilities: ModelCapability[];
  contextWindow: number;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  defaultTemperature: number;
  defaultContextAllocation: number;
  enabled: boolean;
};

export type RoleRoute = {
  primary: string;
  fallbacks?: string[];
  requiredCapabilities: ModelCapability[];
  localOnly?: boolean;
};

export type GenerateRequest = {
  messages: CanonicalMessage[];
  schema?: object;
  temperature?: number;
  maxTokens?: number;
  reasoning?: "disabled" | "enabled" | "provider-default";
  signal?: AbortSignal;
  workflow: string;
  role: ModelRole;
};

export type GenerateResult = {
  text: string;
  toolCalls: CanonicalToolCall[];
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
  modelId: string;
  provider: ModelProviderId;
};

export type ModelProvider = {
  id: ModelProviderId;
  health(model: ModelDefinition, signal?: AbortSignal): Promise<boolean>;
  generate(model: ModelDefinition, request: GenerateRequest): Promise<GenerateResult>;
  stream?(model: ModelDefinition, request: GenerateRequest): Promise<ReadableStream<Uint8Array>>;
};

export class ModelRuntimeError extends Error {
  readonly category:
    | "configuration"
    | "capability"
    | "unavailable"
    | "authentication"
    | "rate-limit"
    | "timeout"
    | "cancelled"
    | "provider";
  readonly provider?: ModelProviderId;

  constructor(
    message: string,
    category:
      | "configuration"
      | "capability"
      | "unavailable"
      | "authentication"
      | "rate-limit"
      | "timeout"
      | "cancelled"
      | "provider",
    provider?: ModelProviderId,
  ) {
    super(message);
    this.name = "ModelRuntimeError";
    this.category = category;
    this.provider = provider;
  }
}
