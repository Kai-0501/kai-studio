import { orchestrateKaiAgent } from "@/lib/kai-agent-plan";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await request.json() as { task?: unknown; target?: { kind?: unknown; value?: unknown } };
  if (typeof body.task !== "string" || !body.task.trim() || !body.target || !["repository", "greenfield"].includes(String(body.target.kind)) || typeof body.target.value !== "string" || !body.target.value.trim()) return Response.json({ error: "Describe the task and choose an approved repository or greenfield workspace." }, { status: 400 });
  try { return Response.json(await orchestrateKaiAgent({ task: body.task, target: { kind: body.target.kind as "repository" | "greenfield", value: body.target.value } })); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Kai Agent could not create a plan." }, { status: 422 }); }
}
