import { NextRequest } from "next/server";
import { scaffoldGreenfield } from "@/lib/greenfield-workspace";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const body = await request.json() as { root?: unknown; templateId?: unknown; projectName?: unknown; confirmed?: unknown };
  if (body.confirmed !== true || typeof body.root !== "string" || typeof body.templateId !== "string" || typeof body.projectName !== "string") return Response.json({ error: "Explicit scaffold approval is required." }, { status: 400 });
  try { return Response.json({ approved: true, ...(await scaffoldGreenfield(body.root, body.templateId, body.projectName)) }, { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Scaffold failed." }, { status: 400 }); }
}
