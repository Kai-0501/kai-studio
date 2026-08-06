import { randomUUID } from "node:crypto";
import { generateChatTitle } from "@/lib/chat-title";
import { listRuns, saveRun } from "@/lib/run-store";
import type { SavedRun } from "@/types/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workflows = {
  "meeting-intelligence": "Meeting Intelligence",
  "editorial-intelligence": "Editorial Intelligence",
  "account-intelligence": "Account Intelligence",
  "general-intelligence": "General Intelligence",
} as const;

export async function GET() {
  return Response.json(await listRuns());
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<SavedRun>;

  const requiredStrings = [
    body.accountName,
    body.salespersonName,
    body.transcript,
    body.compiledPrompt,
    body.model,
    body.output,
  ];

  if (requiredStrings.some((value) => typeof value !== "string" || !value.trim())) {
    return Response.json({ error: "The completed run is missing data." }, { status: 400 });
  }

  const workflowId =
    typeof body.workflowId === "string" && body.workflowId in workflows
      ? (body.workflowId as keyof typeof workflows)
      : "meeting-intelligence";
  const isChat =
    workflowId === "general-intelligence" &&
    (body.inputLabel === "Chat" ||
      body.inputLabel === "Direct opening message" ||
      body.salespersonName === "Chat" ||
      body.salespersonName === "Direct chat");
  const title = isChat
    ? await generateChatTitle(body.transcript!, body.output!, body.model!)
    : undefined;

  const run: SavedRun = {
    id: typeof body.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(body.id) ? body.id : randomUUID(),
    title,
    workflowId,
    workflowName: workflows[workflowId],
    accountName: body.accountName!,
    salespersonName: body.salespersonName!,
    inputLabel:
      typeof body.inputLabel === "string"
        ? body.inputLabel
        : "Original transcript",
    transcript: body.transcript!,
    compiledPrompt: body.compiledPrompt!,
    model: body.model!,
    output: body.output!,
    followUps: [],
    createdAt: new Date().toISOString(),
  };

  return Response.json(await saveRun(run), { status: 201 });
}
