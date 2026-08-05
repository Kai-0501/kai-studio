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
  | "reasoning"
  | "embedding"
  | "image-generation";

export type ModelRole =
  | "coder.primary"
  | "security.preflight"
  | "security.postflight"
  | "editorial.primary"
  | "orchestrator.cloud"
  | "chat.default"
  | "vision.extractor"
  | "vision.reviewer"
  | "image.planner"
  | "image.generator"
  | "diagnostics.primary"
  | "diagnostics.parser"
  | "progress.assessor"
  | "review.primary"
  | "kailore.embedding"
  | "coding.embedding";


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
  family?: string;
  parameterClass?: string;
  architecture?: "dense" | "moe" | "unknown";
  quantization?: string;
  /** Only set when the runtime reports a trustworthy value. */
  estimatedResidentBytes?: number;
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

export type ImageGenerationRequest = {
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  signal?: AbortSignal;
};

export type ImageGenerationResult = {
  imageBase64: string;
  mimeType: string;
  latencyMs: number;
  modelId: string;
  provider: ModelProviderId;
};

export type ModelProvider = {
  id: ModelProviderId;
  health(model: ModelDefinition, signal?: AbortSignal): Promise<boolean>;
  /**
   * Optional, operation-specific readiness check. A model being visible to a
   * runtime is not sufficient evidence that the runtime can execute images.
   */
  validateImageRuntime?(model: ModelDefinition, signal?: AbortSignal): Promise<void>;
  generate(model: ModelDefinition, request: GenerateRequest): Promise<GenerateResult>;
  generateImage?(model: ModelDefinition, request: ImageGenerationRequest): Promise<ImageGenerationResult>;
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
  /** Safe runtime metadata for diagnostics; never include prompts, paths, or secrets. */
  readonly details?: Record<string, string | number | boolean | undefined>;

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
    details?: Record<string, string | number | boolean | undefined>,
  ) {
    super(message);
    this.name = "ModelRuntimeError";
    this.category = category;
    this.provider = provider;
    this.details = details;
  }
}
