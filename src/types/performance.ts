export type GenerationPerformance = {
  id: string;
  model: string;
  label: string;
  tokensPerSecond: number;
  generatedTokens: number;
  durationSeconds: number;
  createdAt: string;
};
