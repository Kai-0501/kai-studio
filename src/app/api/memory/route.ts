import {
  deleteMemory,
  memoryStatus,
  readMemory,
  writeMemory,
} from "@/lib/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MEMORY_CHARACTERS = 120_000;

export async function GET() {
  return Response.json(memoryStatus(await readMemory()));
}

export async function PUT(request: Request) {
  const body = (await request.json()) as {
    content?: unknown;
    sourceName?: unknown;
  };

  if (typeof body.content !== "string" || !body.content.trim()) {
    return Response.json(
      { error: "Paste or import some memory first." },
      { status: 400 },
    );
  }

  if (body.content.length > MAX_MEMORY_CHARACTERS) {
    return Response.json(
      {
        error:
          "This memory is too large. Keep the weekly memory below 120,000 characters.",
      },
      { status: 400 },
    );
  }

  const memory = await writeMemory(
    body.content,
    typeof body.sourceName === "string" ? body.sourceName : undefined,
  );
  return Response.json(memoryStatus(memory));
}

export async function DELETE() {
  await deleteMemory();
  return Response.json(memoryStatus(null));
}
