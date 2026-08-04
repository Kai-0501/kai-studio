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
  codingContextLimit: 16384,
  codingBudgetOverrideMinutes: null,
  modelSearchRoots: [],
  embeddingRuntime: {
    kaiLore: { idleTimeoutSeconds: 120, minimumWarmSeconds: 30, retainDuringIndexing: true, retainAcrossTransitions: false, evictOnMemoryPressure: true },
    coding: { idleTimeoutSeconds: 300, minimumWarmSeconds: 60, retainDuringIndexing: true, retainAcrossTransitions: true, evictOnMemoryPressure: true },
  },
  codingRuntime: {
    executionMode: "multi-agent-sequential",
    inactiveAgentCachePolicy: "checkpoint-reconstruct",
    releaseIdleDiagnosticsBeforeCoding: true,
    releaseIdleKaiLoreBeforeCoding: true,
    modelIdleTimeoutSeconds: 180,
    memoryPressureFallback: "offer-16k",
  },
};

export async function readSettings(): Promise<KaiStudioSettings> {
  try {
    const contents = await readFile(settingsFile, "utf8");
    const saved = JSON.parse(contents) as Partial<KaiStudioSettings>;
    const savedAssignments = (saved.modelAssignments ?? {}) as Partial<KaiStudioSettings["modelAssignments"]> & { embedding?: string };
    // A previous release stored one global `embedding` assignment. Preserve it
    // as the initial choice for both independent domains, rather than silently
    // substituting a different model or losing the user's preference.
    const legacyEmbedding = typeof savedAssignments.embedding === "string" ? savedAssignments.embedding : undefined;
    const nonLegacyAssignments = { ...savedAssignments };
    delete nonLegacyAssignments.embedding;
    const assignments = {
      ...defaultSettings.modelAssignments,
      ...nonLegacyAssignments,
      kaiLoreEmbedding: savedAssignments.kaiLoreEmbedding ?? legacyEmbedding ?? defaultSettings.modelAssignments.kaiLoreEmbedding,
      codingEmbedding: savedAssignments.codingEmbedding ?? legacyEmbedding ?? defaultSettings.modelAssignments.codingEmbedding,
    };
    const savedRuntime = saved.embeddingRuntime as Partial<KaiStudioSettings["embeddingRuntime"]> | undefined;
    const runtime = {
      kaiLore: { ...defaultSettings.embeddingRuntime.kaiLore, ...(savedRuntime?.kaiLore ?? {}) },
      coding: { ...defaultSettings.embeddingRuntime.coding, ...(savedRuntime?.coding ?? {}) },
    };
    const codingRuntime = { ...defaultSettings.codingRuntime, ...(saved.codingRuntime ?? {}) };
    return { ...defaultSettings, ...saved, embeddingRuntime: runtime, codingRuntime, modelAssignments: assignments, modelSearchRoots: Array.isArray(saved.modelSearchRoots) ? saved.modelSearchRoots.filter((root): root is string => typeof root === "string") : [] };
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
