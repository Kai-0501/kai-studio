import { deleteRun, findRun, updateRunConversation } from "@/lib/run-store";
import type { DiagnosticRecommendation, FollowUpMessage } from "@/types/run";

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
    diagnosticsRecommendations?: unknown;
    diagnosticsPlan?: unknown;
    diagnosticSelectedRecommendationIds?: unknown;
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

  const recommendationsValid =
    body.diagnosticsRecommendations === undefined ||
    (Array.isArray(body.diagnosticsRecommendations) &&
      body.diagnosticsRecommendations.length <= 40 &&
      body.diagnosticsRecommendations.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "id" in item &&
          typeof item.id === "string" &&
          "priority" in item &&
          ["critical", "high", "medium", "low", "user-request"].includes(String(item.priority)) &&
          "title" in item &&
          typeof item.title === "string" &&
          "summary" in item &&
          typeof item.summary === "string" &&
          "evidence" in item &&
          typeof item.evidence === "string" &&
          "acceptanceCriteria" in item &&
          Array.isArray(item.acceptanceCriteria),
      ));

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
    !recommendationsValid ||
    (body.output !== undefined &&
      (typeof body.output !== "string" || !body.output.trim())) ||
    (body.model !== undefined &&
      (typeof body.model !== "string" || !body.model.trim()))
    || (body.diagnosticsPlan !== undefined &&
      (typeof body.diagnosticsPlan !== "string" || !body.diagnosticsPlan.trim()))
    || (body.diagnosticSelectedRecommendationIds !== undefined &&
      (!Array.isArray(body.diagnosticSelectedRecommendationIds) ||
        body.diagnosticSelectedRecommendationIds.length > 40 ||
        !body.diagnosticSelectedRecommendationIds.every((id) => typeof id === "string" && id.trim())))
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
    && body.diagnosticsRecommendations === undefined
    && body.diagnosticsPlan === undefined
    && body.diagnosticSelectedRecommendationIds === undefined
  ) {
    return Response.json({ error: "No conversation changes supplied." }, { status: 400 });
  }

  const updated = await updateRunConversation(id, {
    ...(body.followUps !== undefined
      ? { followUps: body.followUps as FollowUpMessage[] }
      : {}),
    ...(typeof body.output === "string" ? { output: body.output } : {}),
    ...(typeof body.model === "string" ? { model: body.model } : {}),
    ...(Array.isArray(body.diagnosticsRecommendations)
      ? { diagnosticsRecommendations: body.diagnosticsRecommendations as DiagnosticRecommendation[] }
      : {}),
    ...(typeof body.diagnosticsPlan === "string" ? { diagnosticsPlan: body.diagnosticsPlan } : {}),
    ...(Array.isArray(body.diagnosticSelectedRecommendationIds)
      ? { diagnosticSelectedRecommendationIds: body.diagnosticSelectedRecommendationIds as string[] }
      : {}),
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
