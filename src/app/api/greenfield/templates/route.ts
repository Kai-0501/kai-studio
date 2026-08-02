import { greenfieldHealth } from "@/lib/greenfield-workspace";
export const runtime = "nodejs";
export async function GET() { return Response.json(await greenfieldHealth()); }
