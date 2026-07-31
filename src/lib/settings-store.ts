import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KaiStudioSettings } from "@/types/settings";

const dataDirectory =
  process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.cwd(), ".promptdeck");
const settingsFile = path.join(dataDirectory, "settings.json");
const temporaryFile = path.join(dataDirectory, "settings.tmp.json");

const defaultSettings: KaiStudioSettings = {
  defaultModel: "gemma4:12b-mlx",
  longTermMemoryEnabled: true,
  memoryDebugEnabled: false,
};

export async function readSettings(): Promise<KaiStudioSettings> {
  try {
    const contents = await readFile(settingsFile, "utf8");
    return { ...defaultSettings, ...(JSON.parse(contents) as KaiStudioSettings) };
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
