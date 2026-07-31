import { deleteRun, findRun, updateRunConversation } from "@/lib/run-store";
import type { FollowUpMessage } from "@/types/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const run = await findRun(id);

  if (!run) {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }

  return Response.json(run);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    followUps?: unknown;
    output?: unknown;
    model?: unknown;
  };

  if (
    body.followUps !== undefined &&
    (!Array.isArray(body.followUps) || body.followUps.length > 40)
  ) {
    return Response.json(
      { error: "Follow-up conversation is invalid or too long." },
      { status: 400 },
    );
  }

  const valid =
    body.followUps === undefined ||
    body.followUps.every(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      ("role" in message &&
        (message.role === "user" || message.role === "assistant")) &&
      ("content" in message &&
        typeof message.content === "string" &&
        message.content.trim()) &&
      ("createdAt" in message && typeof message.createdAt === "string"),
    );

  if (
    !valid ||
    (body.output !== undefined &&
      (typeof body.output !== "string" || !body.output.trim())) ||
    (body.model !== undefined &&
      (typeof body.model !== "string" || !body.model.trim()))
  ) {
    return Response.json(
      { error: "Follow-up conversation contains invalid messages." },
      { status: 400 },
    );
  }

  if (
    body.followUps === undefined &&
    body.output === undefined &&
    body.model === undefined
  ) {
    return Response.json({ error: "No conversation changes supplied." }, { status: 400 });
  }

  const updated = await updateRunConversation(id, {
    ...(body.followUps !== undefined
      ? { followUps: body.followUps as FollowUpMessage[] }
      : {}),
    ...(typeof body.output === "string" ? { output: body.output } : {}),
    ...(typeof body.model === "string" ? { model: body.model } : {}),
  });

  if (!updated) {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }

  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const deleted = await deleteRun(id);

  if (!deleted) {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }

  return Response.json({ deleted: true });
}
