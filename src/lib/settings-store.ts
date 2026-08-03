import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KaiStudioSettings } from "@/types/settings";
import { defaultModelAssignments } from "@/lib/models/roles";

const dataDirectory =
  process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.cwd(), ".promptdeck");
const settingsFile = path.join(dataDirectory, "settings.json");
const temporaryFile = path.join(dataDirectory, "settings.tmp.json");

const defaultSettings: KaiStudioSettings = {
  defaultModel: "gemma4:12b-mlx",
  modelAssignments: defaultModelAssignments,
  longTermMemoryEnabled: true,
  memoryDebugEnabled: false,
  codingContextLimit: 32768,
  codingBudgetOverrideMinutes: null,
  modelSearchRoots: [],
};

export async function readSettings(): Promise<KaiStudioSettings> {
  try {
    const contents = await readFile(settingsFile, "utf8");
    const saved = JSON.parse(contents) as Partial<KaiStudioSettings>;
    return { ...defaultSettings, ...saved, modelAssignments: { ...defaultSettings.modelAssignments, ...(saved.modelAssignments ?? {}) }, modelSearchRoots: Array.isArray(saved.modelSearchRoots) ? saved.modelSearchRoots.filter((root): root is string => typeof root === "string") : [] };
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
