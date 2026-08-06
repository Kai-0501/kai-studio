import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConversationCheckpoint, ConversationMessage, DiagnosticRecommendation, FollowUpMessage, SavedRun } from "@/types/run";

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

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function migrateRunConversation(run: SavedRun): SavedRun {
  if (run.schemaVersion === 2 && run.messages?.length && run.activeBranchId) return run;
  const branchId = run.activeBranchId ?? `branch-${digest(`${run.id}:main`).slice(0, 20)}`;
  const legacy = [
    { role: "user" as const, content: run.transcript, createdAt: run.createdAt },
    { role: "assistant" as const, content: run.output, createdAt: run.createdAt },
    ...(run.followUps ?? []).map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      existing: message,
    })),
  ].filter((message) => message.content.trim());
  let parentId: string | null = null;
  const messages: ConversationMessage[] = legacy.map((message, index) => {
    const existing = "existing" in message ? message.existing : undefined;
    const id = existing?.id ?? `msg-${digest(`${run.id}:${index}:${message.role}:${message.content}`).slice(0, 24)}`;
    const createdAt = message.createdAt || run.createdAt;
    const migrated: ConversationMessage = {
      id,
      parentId: existing?.parentId === undefined ? parentId : existing.parentId,
      branchId: existing?.branchId ?? branchId,
      revision: existing?.revision ?? 1,
      role: message.role,
      content: message.content,
      createdAt,
      updatedAt: existing?.updatedAt ?? createdAt,
      contentHash: existing?.contentHash ?? digest(message.content),
      deletedAt: existing?.deletedAt ?? null,
    };
    parentId = id;
    return migrated;
  });
  return { ...run, schemaVersion: 2, activeBranchId: branchId, messages };
}

async function writeRuns(runs: SavedRun[]) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(temporaryFile, JSON.stringify(runs, null, 2), "utf8");
  await rename(temporaryFile, dataFile);
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
  const index = runs.findIndex((run) => run.id === id);
  if (index === -1) return null;
  const migrated = migrateRunConversation(runs[index]);
  if (migrated !== runs[index]) {
    runs[index] = migrated;
    await writeRuns(runs);
  }
  return migrated;
}

export async function saveRun(run: SavedRun) {
  const runs = await readRunsFile();
  const migrated = migrateRunConversation(run);
  runs.unshift(migrated);
  await writeRuns(runs);
  return migrated;
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
    diagnosticsRecommendations?: DiagnosticRecommendation[];
    diagnosticsPlan?: string;
    diagnosticSelectedRecommendationIds?: string[];
    messages?: ConversationMessage[];
    activeBranchId?: string;
    checkpoint?: ConversationCheckpoint;
  },
) {
  await mkdir(dataDirectory, { recursive: true });
  const runs = await readRunsFile();
  const index = runs.findIndex((run) => run.id === id);
  if (index === -1) return null;

  const merged = { ...runs[index], ...changes };
  // Legacy follow-up writes remain supported while the UI migrates. Rebuild the
  // canonical message chain deterministically so new turns are immediately
  // available to the conversation archive index.
  if (changes.followUps && !changes.messages) {
    merged.schemaVersion = undefined;
    merged.messages = undefined;
  }
  runs[index] = migrateRunConversation(merged);
  await writeRuns(runs);
  return runs[index];
}

export async function deleteRun(id: string) {
  await mkdir(dataDirectory, { recursive: true });
  const runs = await readRunsFile();
  const remainingRuns = runs.filter((run) => run.id !== id);
  if (remainingRuns.length === runs.length) return false;

  await writeRuns(remainingRuns);
  try {
    const { removeConversationMemory } = await import("@/lib/conversation-memory/runtime");
    await removeConversationMemory(id);
  } catch {
    // The durable run is already gone; an index cleanup can safely retry later.
  }
  return true;
}
