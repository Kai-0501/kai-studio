export type KaiStudioSettings = {
  defaultModel: string;
  longTermMemoryEnabled: boolean;
  memoryDebugEnabled: boolean;
};

export type LocalModel = {
  name: string;
  size: number;
  modifiedAt: string;
};

export type SystemStatus = {
  ollamaOnline: boolean;
  models: LocalModel[];
  checkedAt: string;
  error?: string;
};
