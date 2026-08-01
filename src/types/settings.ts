export type KaiStudioSettings = {
  defaultModel: string;
  modelAssignments: ModelAssignments;
  longTermMemoryEnabled: boolean;
  memoryDebugEnabled: boolean;
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
