import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FollowUpMessage, SavedRun } from "@/types/run";

const dataDirectory =
  process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.cwd(), ".promptdeck");
const dataFile = path.join(dataDirectory, "runs.json");
const temporaryFile = path.join(dataDirectory, "runs.tmp.json");

async function readRunsFile(): Promise<SavedRun[]> {
  try {
    const contents = await readFile(dataFile, "utf8");
    return JSON.parse(contents) as SavedRun[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function listRuns() {
  const runs = await readRunsFile();
  return runs.sort(
    (first, second) =>
      new Date(second.createdAt).getTime() -
      new Date(first.createdAt).getTime(),
  );
}

export async function findRun(id: string) {
  const runs = await readRunsFile();
  return runs.find((run) => run.id === id) ?? null;
}

export async function saveRun(run: SavedRun) {
  await mkdir(dataDirectory, { recursive: true });
  const runs = await readRunsFile();
  runs.unshift(run);
  await writeFile(temporaryFile, JSON.stringify(runs, null, 2), "utf8");
  await rename(temporaryFile, dataFile);
  return run;
}

export async function updateRunFollowUps(
  id: string,
  followUps: FollowUpMessage[],
) {
  return updateRunConversation(id, { followUps });
}

export async function updateRunConversation(
  id: string,
  changes: {
    followUps?: FollowUpMessage[];
    output?: string;
    model?: string;
  },
) {
  await mkdir(dataDirectory, { recursive: true });
  const runs = await readRunsFile();
  const index = runs.findIndex((run) => run.id === id);
  if (index === -1) return null;

  runs[index] = { ...runs[index], ...changes };
  await writeFile(temporaryFile, JSON.stringify(runs, null, 2), "utf8");
  await rename(temporaryFile, dataFile);
  return runs[index];
}

export async function deleteRun(id: string) {
  await mkdir(dataDirectory, { recursive: true });
  const runs = await readRunsFile();
  const remainingRuns = runs.filter((run) => run.id !== id);
  if (remainingRuns.length === runs.length) return false;

  await writeFile(
    temporaryFile,
    JSON.stringify(remainingRuns, null, 2),
    "utf8",
  );
  await rename(temporaryFile, dataFile);
  return true;
}
