import { ensureManagedLocalModel } from "@/lib/local-model-runtime";

export const runtime = "nodejs";

/**
 * Starts a bounded health check only after an explicit click in Settings.
 * Discovery never loads large user-managed weights on its own.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { model?: unknown };
  if (typeof body.model !== "string" || !body.model.startsWith("local:")) {
    return Response.json({ error: "Choose a discovered local model first." }, { status: 400 });
  }

  try {
    await ensureManagedLocalModel(body.model);
    return Response.json({ available: true });
  } catch (error) {
    return Response.json(
      { available: false, error: error instanceof Error ? error.message : "Local runtime validation failed." },
      { status: 503 },
    );
  }
}
