import { NextRequest } from "next/server";
import { approveGreenfieldRoot, getGreenfieldTemplate, safeGreenfieldTarget } from "@/lib/greenfield-workspace";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const body = await request.json() as { root?: unknown; templateId?: unknown; paths?: unknown };
  if (typeof body.root !== "string" || typeof body.templateId !== "string") return Response.json({ error: "Approved root and template are required." }, { status: 400 });
  const template = getGreenfieldTemplate(body.templateId);
  if (!template) return Response.json({ error: "Unsupported greenfield template." }, { status: 400 });
  try {
    const root = await approveGreenfieldRoot(body.root);
    const paths = Array.isArray(body.paths) ? body.paths.filter((item): item is string => typeof item === "string").slice(0, 50) : [];
    for (const item of paths) await safeGreenfieldTarget(root, item);
    return Response.json({ approved: true, root, template });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Workspace validation failed." }, { status: 400 }); }
}
