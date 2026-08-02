import { NextRequest } from "next/server";
import {
  normalizeDiagnosticRecommendations,
  orchestrateSelectedDiagnostics,
  structureDiagnosticReport,
} from "@/lib/diagnostic-recommendations";
import { findRun, updateRunConversation } from "@/lib/run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function recommendationsFor(id: string) {
  const run = await findRun(id);
  if (!run || run.workflowId !== "diagnostics") return null;
  const existing = normalizeDiagnosticRecommendations(run.diagnosticsRecommendations);
  if (existing.length) return { run, recommendations: existing };
  const structured = await structureDiagnosticReport(run.output, run.followUps ?? []);
  const updated = await updateRunConversation(id, {
    output: structured.report,
    diagnosticsRecommendations: structured.recommendations,
  });
  return updated
    ? { run: updated, recommendations: structured.recommendations }
    : null;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let result;
  try { result = await recommendationsFor(id); } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Diagnostics parsing failed.", retryable: true }, { status: 422 });
  }
  if (!result) return Response.json({ error: "Diagnostics run not found." }, { status: 404 });
  return Response.json({ recommendations: result.recommendations, report: result.run.output });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as { selectedIds?: unknown; customRequest?: unknown };
  const selectedIds = Array.isArray(body.selectedIds)
    ? body.selectedIds.filter((value): value is string => typeof value === "string")
    : [];
  const customRequest = typeof body.customRequest === "string" ? body.customRequest.trim().slice(0, 4_000) : "";
  if (!selectedIds.length && !customRequest) {
    return Response.json({ error: "Select at least one recommendation or add a user request." }, { status: 400 });
  }

  let result;
  try { result = await recommendationsFor(id); } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Diagnostics parsing failed.", retryable: true }, { status: 422 });
  }
  if (!result) return Response.json({ error: "Diagnostics run not found." }, { status: 404 });
  const known = new Map(result.recommendations.map((item) => [item.id, item]));
  if (selectedIds.some((selectedId) => !known.has(selectedId))) {
    return Response.json({ error: "The selected diagnostics plan is stale. Reopen the picker and try again." }, { status: 400 });
  }
  const selected = [...new Set(selectedIds)].map((selectedId) => known.get(selectedId)!);
  const plan = await orchestrateSelectedDiagnostics(result.run.output, selected, customRequest);
  await updateRunConversation(id, {
    diagnosticsPlan: plan,
    diagnosticSelectedRecommendationIds: selected.map((item) => item.id),
  });
  return Response.json({
    plan,
    href: `/chat/github/Kai-0501/kai-studio?autostart=1&diagnosticRun=${encodeURIComponent(id)}`,
  });
}
