export type KaiStudioSettings = {
  defaultModel: string;
  modelAssignments: ModelAssignments;
  longTermMemoryEnabled: boolean;
  memoryDebugEnabled: boolean;
  codingContextLimit: 16384 | 32768;
  codingBudgetOverrideMinutes: number | null;
  modelSearchRoots: string[];
  embeddingRuntime: EmbeddingRuntimeSettings;
  codingRuntime: CodingRuntimeSettings;
  imageGeneration: ImageGenerationSettings;
};

export type CodingRuntimeSettings = {
  executionMode: "single-agent" | "multi-agent-sequential";
  inactiveAgentCachePolicy: "checkpoint-reconstruct" | "retain-bounded";
  releaseIdleDiagnosticsBeforeCoding: boolean;
  releaseIdleKaiLoreBeforeCoding: boolean;
  modelIdleTimeoutSeconds: number;
  memoryPressureFallback: "offer-16k" | "pause" | "single-agent";
};

export type EmbeddingRuntimeSettings = {
  kaiLore: EmbeddingRuntimePolicy;
  coding: EmbeddingRuntimePolicy;
};

export type ImageGenerationSettings = {
  autoReview: boolean;
  maxCorrectiveRetries: 0 | 1 | 2;
  mandatoryConfidenceThreshold: number;
  retryPreferredRequirements: boolean;
  reviewTimeoutSeconds: number;
  saveAllAttempts: boolean;
  preserveCompiledPrompts: boolean;
  visionUnavailableBehaviour: "return-unverified" | "fail";
};

export type EmbeddingRuntimePolicy = {
  idleTimeoutSeconds: number;
  minimumWarmSeconds: number;
  retainDuringIndexing: boolean;
  retainAcrossTransitions: boolean;
  evictOnMemoryPressure: boolean;
};

export type ModelAssignments = {
  chat: string;
  meeting: string;
  editorial: string;
  account: string;
  general: string;
  coding: string;
  security: string;
  vision: string;
  imagePlanner: string;
  image: string;
  diagnostics: string;
  diagnosticsParser: string;
  progressAssessor: string;
  orchestration: string;
  review: string;
  /**
   * Legacy shared embedding assignment. Kept only so existing settings files
   * can migrate without being discarded; new code must use the two scoped
   * assignments below.
   */
  embedding?: string;
  kaiLoreEmbedding: string;
  codingEmbedding: string;
};

export type LocalModel = {
  name: string;
  size: number;
  modifiedAt: string;
  capabilities?: string[];
  provider?: "ollama" | "huggingface" | "mlx" | "llamacpp" | "manual";
  displayName?: string;
  source?: "ollama" | "kai-managed-huggingface" | "huggingface-cache" | "user-managed-local" | "manual-registration" | "managed-mlx" | "managed-llamacpp";
  ownership?: "kai-managed" | "user-managed" | "manual";
  runtime?: "ollama" | "llama.cpp" | "mlx" | "external";
  status?: "available" | "candidate" | "unavailable";
  statusReason?: string;
  canonicalPath?: string;
  repository?: string;
  revision?: string;
  architecture?: "dense" | "moe" | "unknown";
  family?: string;
  parameterClass?: string;
  quantization?: string;
};

export type SystemStatus = {
  ollamaOnline: boolean;
  models: LocalModel[];
  huggingFaceModels?: LocalModel[];
  discoveredModels?: LocalModel[];
  checkedAt: string;
  error?: string;
};
