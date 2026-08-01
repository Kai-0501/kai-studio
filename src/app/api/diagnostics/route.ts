import { NextResponse } from "next/server";
import { createDiagnosticsJob, latestDiagnosticsJob } from "@/lib/diagnostics-jobs";

export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json(latestDiagnosticsJob()); }
export async function POST() { return NextResponse.json(createDiagnosticsJob(), { status: 202 }); }
