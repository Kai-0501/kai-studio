import { NextResponse } from "next/server";
import { diagnosticsJobs } from "@/lib/diagnostics-jobs";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = diagnosticsJobs.get(id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "Diagnostic not found." }, { status: 404 });
}
