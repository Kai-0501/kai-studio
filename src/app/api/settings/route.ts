import { readSettings, writeSettings } from "@/lib/settings-store";
import type { ModelAssignments } from "@/types/settings";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSafeModelRoot(value: string) {
  const root = path.resolve(value.trim());
  const home = path.resolve(os.homedir());
  // A model root must be a deliberate subfolder.  Scanning / or the whole
  // home directory would turn a local convenience feature into broad file
  // discovery, so reject both (and Git internals) at registration time.
  return root !== path.parse(root).root && root !== home && !root.split(path.sep).includes(".git");
}

export async function GET() {
  return Response.json(await readSettings());
}

export async function PUT(request: Request) {
  const body = (await request.json()) as {
    defaultModel?: unknown;
    modelAssignments?: unknown;
    longTermMemoryEnabled?: unknown;
    memoryDebugEnabled?: unknown;
    codingContextLimit?: unknown;
    codingBudgetOverrideMinutes?: unknown;
    modelSearchRoots?: unknown;
  };

  if (
    body.defaultModel !== undefined &&
    (typeof body.defaultModel !== "string" ||
      !body.defaultModel.trim())
  ) {
    return Response.json(
      { error: "Choose an installed local model." },
      { status: 400 },
    );
  }

  if (body.modelSearchRoots !== undefined && (!Array.isArray(body.modelSearchRoots) || body.modelSearchRoots.some((root) => typeof root !== "string" || !root.trim() || root.length > 4096 || !isSafeModelRoot(root)))) {
    return Response.json({ error: "Model folders must be valid local paths." }, { status: 400 });
  }

  if (body.codingContextLimit !== undefined && body.codingContextLimit !== 16384 && body.codingContextLimit !== 32768) {
    return Response.json({ error: "Coding context must be 16K or 32K." }, { status: 400 });
  }
  if (body.codingBudgetOverrideMinutes !== undefined && body.codingBudgetOverrideMinutes !== null && (typeof body.codingBudgetOverrideMinutes !== "number" || !Number.isFinite(body.codingBudgetOverrideMinutes) || body.codingBudgetOverrideMinutes < 5 || body.codingBudgetOverrideMinutes > 180)) {
    return Response.json({ error: "Coding time override must be between 5 and 180 minutes." }, { status: 400 });
  }

  const assignments = body.modelAssignments;
  if (assignments !== undefined && (typeof assignments !== "object" || assignments === null || Object.values(assignments).some((value) => typeof value !== "string" || !value.trim()))) {
    return Response.json({ error: "Every workflow must have a local model assignment." }, { status: 400 });
  }

  if (
    (body.longTermMemoryEnabled !== undefined &&
      typeof body.longTermMemoryEnabled !== "boolean") ||
    (body.memoryDebugEnabled !== undefined &&
      typeof body.memoryDebugEnabled !== "boolean")
  ) {
    return Response.json(
      { error: "Memory settings must be on or off." },
      { status: 400 },
    );
  }

  return Response.json(await writeSettings({
    ...(typeof body.defaultModel === "string"
      ? { defaultModel: body.defaultModel }
      : {}),
    ...(assignments && typeof assignments === "object"
      ? { modelAssignments: assignments as ModelAssignments }
      : {}),
    ...(typeof body.longTermMemoryEnabled === "boolean"
      ? { longTermMemoryEnabled: body.longTermMemoryEnabled }
      : {}),
    ...(typeof body.memoryDebugEnabled === "boolean"
      ? { memoryDebugEnabled: body.memoryDebugEnabled }
      : {}),
    ...(body.codingContextLimit === 16384 || body.codingContextLimit === 32768 ? { codingContextLimit: body.codingContextLimit } : {}),
    ...(body.codingBudgetOverrideMinutes === null || typeof body.codingBudgetOverrideMinutes === "number" ? { codingBudgetOverrideMinutes: body.codingBudgetOverrideMinutes } : {}),
    ...(Array.isArray(body.modelSearchRoots) ? { modelSearchRoots: [...new Set(body.modelSearchRoots.map((root) => path.resolve(root.trim())))] } : {}),
  }));
}
