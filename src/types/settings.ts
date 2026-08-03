export type KaiStudioSettings = {
  defaultModel: string;
  modelAssignments: ModelAssignments;
  longTermMemoryEnabled: boolean;
  memoryDebugEnabled: boolean;
  codingContextLimit: 16384 | 32768;
  codingBudgetOverrideMinutes: number | null;
  modelSearchRoots: string[];
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
