export type KaiStudioSettings = {
  defaultModel: string;
  longTermMemoryEnabled: boolean;
  memoryDebugEnabled: boolean;
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
