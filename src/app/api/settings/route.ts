import { readSettings, writeSettings } from "@/lib/settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supportedModels = new Set([
  "gemma4:12b-mlx",
  "gemma4:26b-mlx",
  "gemma4:31b-mlx",
  "hf:gemma4-26b-a4b-q4",
]);

export async function GET() {
  return Response.json(await readSettings());
}

export async function PUT(request: Request) {
  const body = (await request.json()) as {
    defaultModel?: unknown;
    longTermMemoryEnabled?: unknown;
    memoryDebugEnabled?: unknown;
  };

  if (
    body.defaultModel !== undefined &&
    (typeof body.defaultModel !== "string" ||
      !supportedModels.has(body.defaultModel))
  ) {
    return Response.json(
      { error: "Choose an installed Kai Studio Gemma model." },
      { status: 400 },
    );
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
    ...(typeof body.longTermMemoryEnabled === "boolean"
      ? { longTermMemoryEnabled: body.longTermMemoryEnabled }
      : {}),
    ...(typeof body.memoryDebugEnabled === "boolean"
      ? { memoryDebugEnabled: body.memoryDebugEnabled }
      : {}),
  }));
}
