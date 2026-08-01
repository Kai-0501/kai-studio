import { readSettings, writeSettings } from "@/lib/settings-store";
import type { ModelAssignments } from "@/types/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await readSettings());
}

export async function PUT(request: Request) {
  const body = (await request.json()) as {
    defaultModel?: unknown;
    modelAssignments?: unknown;
    longTermMemoryEnabled?: unknown;
    memoryDebugEnabled?: unknown;
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
  }));
}
