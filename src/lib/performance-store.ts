import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GenerationPerformance } from "@/types/performance";

const dataDirectory =
  process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.cwd(), ".promptdeck");
const dataFile = path.join(dataDirectory, "performance.json");
const temporaryFile = path.join(dataDirectory, "performance.tmp.json");

async function readPerformanceFile(): Promise<GenerationPerformance[]> {
  try {
    const contents = await readFile(dataFile, "utf8");
    return JSON.parse(contents) as GenerationPerformance[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function listPerformance() {
  const records = await readPerformanceFile();
  return records.sort(
    (first, second) =>
      new Date(second.createdAt).getTime() -
      new Date(first.createdAt).getTime(),
  );
}

export async function recordPerformance(input: {
  model: string;
  label: string;
  generatedTokens: number;
  evaluationDurationNanoseconds: number;
}) {
  const durationSeconds = input.evaluationDurationNanoseconds / 1_000_000_000;
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isFinite(input.generatedTokens) ||
    input.generatedTokens <= 0
  ) {
    return null;
  }

  const record: GenerationPerformance = {
    id: randomUUID(),
    model: input.model,
    label: input.label.trim().slice(0, 100) || "Untitled chat",
    tokensPerSecond: input.generatedTokens / durationSeconds,
    generatedTokens: input.generatedTokens,
    durationSeconds,
    createdAt: new Date().toISOString(),
  };

  await mkdir(dataDirectory, { recursive: true });
  const records = await readPerformanceFile();
  records.unshift(record);
  await writeFile(
    temporaryFile,
    JSON.stringify(records.slice(0, 500), null, 2),
    "utf8",
  );
  await rename(temporaryFile, dataFile);
  return record;
}
