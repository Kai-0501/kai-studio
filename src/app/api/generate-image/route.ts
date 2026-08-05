import { runBoundedImagePipeline } from "@/lib/image-generation/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { prompt?: unknown };
    if (typeof body.prompt !== "string") return Response.json({ error: "Describe the image you want to create." }, { status: 400 });
    const stages: string[] = [];
    const result = await runBoundedImagePipeline(body.prompt, (stage) => stages.push(stage));
    return Response.json({ id: result.record.id, image: result.image, status: result.record.status, attempts: result.record.attempts.map((attempt) => ({ number: attempt.number, status: attempt.status, review: attempt.review, compiledPrompt: attempt.compiledPrompt, provider: attempt.provider, model: attempt.model })), intent: result.record.intent, stages });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Kai Studio could not create that image." }, { status: 500 });
  }
}
