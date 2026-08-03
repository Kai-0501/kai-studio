export type KaiStudioSettings = {
  defaultModel: string;
  modelAssignments: ModelAssignments;
  longTermMemoryEnabled: boolean;
  memoryDebugEnabled: boolean;
  codingContextLimit: 16384 | 32768;
  codingBudgetOverrideMinutes: number | null;
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
  embedding: string;
};

export type LocalModel = {
  name: string;
  size: number;
  modifiedAt: string;
  provider?: "ollama" | "huggingface";
};

export type SystemStatus = {
  ollamaOnline: boolean;
  models: LocalModel[];
  huggingFaceModels?: LocalModel[];
  checkedAt: string;
  error?: string;
};
