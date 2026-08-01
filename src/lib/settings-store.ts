import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KaiStudioSettings } from "@/types/settings";

const dataDirectory =
  process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.cwd(), ".promptdeck");
const settingsFile = path.join(dataDirectory, "settings.json");
const temporaryFile = path.join(dataDirectory, "settings.tmp.json");

const defaultSettings: KaiStudioSettings = {
  defaultModel: "gemma4:12b-mlx",
  modelAssignments: {
    chat: "gemma4:26b-mlx",
    meeting: "gemma4:12b-mlx",
    editorial: "gemma4:12b-mlx",
    account: "gemma4:26b-mlx",
    general: "gemma4:26b-mlx",
    coding: "qwen3.6:27b-mtp-q4_K_M",
    security: "gemma4:31b-mlx",
    vision: "glm-ocr",
    diagnostics: "gemma4:31b-mlx",
  },
  longTermMemoryEnabled: true,
  memoryDebugEnabled: false,
};

export async function readSettings(): Promise<KaiStudioSettings> {
  try {
    const contents = await readFile(settingsFile, "utf8");
    const saved = JSON.parse(contents) as Partial<KaiStudioSettings>;
    return { ...defaultSettings, ...saved, modelAssignments: { ...defaultSettings.modelAssignments, ...(saved.modelAssignments ?? {}) } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultSettings;
    throw error;
  }
}

export async function writeSettings(settings: Partial<KaiStudioSettings>) {
  const nextSettings = { ...(await readSettings()), ...settings };
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(
    temporaryFile,
    JSON.stringify(nextSettings, null, 2),
    "utf8",
  );
  await rename(temporaryFile, settingsFile);
  return nextSettings;
}
