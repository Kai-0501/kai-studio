import { latestRetrievalReport } from "@/lib/memory/runtime";
import { workingMemoryMetrics } from "@/lib/memory/session";
import { readSettings } from "@/lib/settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const settings = await readSettings();
  if (!settings.memoryDebugEnabled) {
    return Response.json(
      { error: "Memory diagnostics are disabled." },
      { status: 404 },
    );
  }
  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) {
    return Response.json(
      { error: "A valid memory session ID is required." },
      { status: 400 },
    );
  }
  return Response.json({
    report: latestRetrievalReport(sessionId),
    workingMemoryCache: workingMemoryMetrics(),
  });
}
