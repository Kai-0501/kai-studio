import { kaiLoreMemoryRetriever } from "@/lib/memory/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { domain?: unknown };
  if (body.domain !== "kailore") return Response.json({ error: "Coding indexes are refreshed from their approved repository workspace, not from a global settings action." }, { status: 400 });
  const retriever = await kaiLoreMemoryRetriever();
  return Response.json({ domain: "kailore", result: await retriever.reindex() });
}
