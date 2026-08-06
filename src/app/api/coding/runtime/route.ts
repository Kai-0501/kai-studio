import { NextRequest } from "next/server";
import { codingRuntimeCoordinator } from "@/lib/coding-runtime";
import { generativeRuntimeManager } from "@/lib/generative-runtime";
import { embeddingRuntimeManager } from "@/lib/embedding-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  return Response.json({
    job: jobId ? codingRuntimeCoordinator.snapshot(jobId) ?? null : null,
    jobs: jobId ? undefined : codingRuntimeCoordinator.snapshots(),
    generative: generativeRuntimeManager.snapshots(),
    embeddings: embeddingRuntimeManager.snapshots(),
    checkedAt: new Date().toISOString(),
  });
}
