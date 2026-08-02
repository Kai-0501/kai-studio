import { NextRequest } from "next/server";
import { validateKaiAgentPlan, type KaiAgentPlan } from "@/lib/kai-agent-plan";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json() as { plan?: unknown; task?: unknown; target?: { kind?: unknown; value?: unknown } };
  if (!body.plan || typeof body.task !== "string" || !body.target || !["repository", "greenfield"].includes(String(body.target.kind)) || typeof body.target.value !== "string") return Response.json({ error: "A complete plan, task, and approved target are required." }, { status: 400 });
  const validation = validateKaiAgentPlan(body.plan as KaiAgentPlan);
  if (!validation.ready) return Response.json({ error: `Plan is not ready: ${validation.missing.join(", ")}` }, { status: 422 });
  if (body.target.kind === "greenfield") return Response.json({ error: "Choose a template and approved project root in Greenfield Workspace before coding." }, { status: 409 });
  const [owner, repo] = body.target.value.split("/").map((part) => part.trim());
  if (!owner || !repo || owner.includes("..") || repo.includes("..")) return Response.json({ error: "Use an owned repository in owner/repository format." }, { status: 400 });
  const response = await fetch(`${new URL(request.url).origin}/api/github/build/active`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, repo, task: body.task.trim() }) });
  const result = await response.json();
  if (!response.ok) return Response.json(result, { status: response.status });
  return Response.json({ ...result, href: `/chat/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?job=${encodeURIComponent(result.id)}` }, { status: 202 });
}
