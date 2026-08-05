import { getImageGeneration, imageDataUrl } from "@/lib/image-generation/pipeline";

export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getImageGeneration(id);
  if (!record) return Response.json({ error: "Image generation not found." }, { status: 404 });
  return Response.json({ ...record, image: await imageDataUrl(record) });
}
