import { embeddingRuntimeManager } from "@/lib/embedding-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ runtimes: embeddingRuntimeManager.snapshots(), checkedAt: new Date().toISOString() });
}
