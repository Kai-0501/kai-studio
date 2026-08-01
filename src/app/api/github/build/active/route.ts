import { NextRequest } from "next/server";
import {
  activeBuildJobs,
  publicActiveBuild,
  type ActiveBuildEvent,
  type ActiveBuildJob,
} from "@/lib/active-build-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function consumeEvents(response: Response, onEvent: (event: ActiveBuildEvent) => void) {
  if (!response.ok || !response.body) {
    const body = await response.text();
    throw new Error(body || "The secure build service could not start.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as ActiveBuildEvent);
    }
  }
}

function addEvent(job: ActiveBuildJob, event: ActiveBuildEvent) {
  job.events.push(event);
  job.updatedAt = new Date().toISOString();
}

async function runJob(job: ActiveBuildJob, origin: string) {
  try {
    let pendingBuildId = "";
    await consumeEvents(
      await fetch(`${origin}/api/github/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: job.owner, repo: job.repo, task: job.task, diagnosticRunId: job.diagnosticRunId }),
      }),
      (event) => {
        if (event.type === "error") throw new Error(event.error || "Security preflight failed.");
        if (event.type === "progress") addEvent(job, event);
        if (event.type === "final" && event.buildId) pendingBuildId = event.buildId;
      },
    );
    if (!pendingBuildId) throw new Error("The build preparation stopped without an approved build.");
    addEvent(job, { type: "progress", message: job.diagnosticRunId ? "Qwen is starting the selected diagnostics implementation now." : "The security preflight passed. Qwen is starting the bounded implementation now." });
    await consumeEvents(
      await fetch(`${origin}/api/github/build/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildId: pendingBuildId }),
      }),
      (event) => {
        if (event.type === "error") throw new Error(event.error || "The coding run failed.");
        addEvent(job, event);
      },
    );
    if (!job.events.some((event) => event.type === "final")) {
      throw new Error("The coding run stopped without a completion report.");
    }
    job.status = "complete";
  } catch (error) {
    job.status = "failed";
    addEvent(job, {
      type: "error",
      error: error instanceof Error ? error.message : "The secure build failed.",
    });
  } finally {
    job.updatedAt = new Date().toISOString();
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { owner?: unknown; repo?: unknown; task?: unknown; diagnosticRunId?: unknown };
  if (typeof body.owner !== "string" || typeof body.repo !== "string" || typeof body.task !== "string" || !body.task.trim()) {
    return Response.json({ error: "Repository and task are required." }, { status: 400 });
  }
  const job: ActiveBuildJob = {
    id: crypto.randomUUID(),
    owner: body.owner,
    repo: body.repo,
    task: body.task.trim(),
    ...(typeof body.diagnosticRunId === "string" ? { diagnosticRunId: body.diagnosticRunId } : {}),
    status: "running",
    events: [{ type: "progress", message: typeof body.diagnosticRunId === "string" ? "The selected diagnostics plan is being handed directly to Qwen." : "The secure build session is starting." }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  activeBuildJobs.set(job.id, job);
  void runJob(job, new URL(request.url).origin);
  return Response.json(publicActiveBuild(job), { status: 202 });
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const job = activeBuildJobs.get(id);
    return job ? Response.json(publicActiveBuild(job)) : Response.json({ error: "Build session not found." }, { status: 404 });
  }
  const running = [...activeBuildJobs.values()]
    .filter((job) => job.status === "running")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return Response.json({ active: running ? publicActiveBuild(running) : null });
}
