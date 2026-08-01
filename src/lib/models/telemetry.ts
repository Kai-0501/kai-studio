import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ModelProviderId, ModelRole } from "@/lib/models/types";

const directory = process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.cwd(), ".promptdeck");

export type InferenceTelemetry = {
  timestamp: string;
  workflow: string;
  role: ModelRole;
  modelId: string;
  provider: ModelProviderId;
  fallbackUsed: boolean;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  toolCallCount: number;
  retryCount: number;
  status: "completed" | "failed";
  errorCategory?: string;
};

export async function recordInference(event: InferenceTelemetry) {
  try {
    await mkdir(directory, { recursive: true });
    await appendFile(path.join(directory, "model-inference.ndjson"), `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch { /* Telemetry must never interrupt inference. */ }
}
