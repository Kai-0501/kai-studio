import type { SystemStatus } from "@/types/settings";
import { listHuggingFaceModels } from "@/lib/local-model-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OllamaTagsResponse = {
  models?: Array<{
    name: string;
    size: number;
    modified_at: string;
    capabilities?: string[];
  }>;
};

export async function GET() {
  const checkedAt = new Date().toISOString();
  const huggingFaceModels = (await listHuggingFaceModels()).map((model) => ({
    name: model.id,
    size: model.size,
    modifiedAt: checkedAt,
    provider: "huggingface" as const,
  }));

  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);

    const body = (await response.json()) as OllamaTagsResponse;
    const models = (body.models ?? [])
      .filter((model) => model.name.startsWith("gemma4:"))
      .map((model) => ({
        name: model.name,
        size: model.size,
        modifiedAt: model.modified_at,
        provider: "ollama" as const,
      }));

    const status: SystemStatus = {
      ollamaOnline: true,
      models,
      huggingFaceModels,
      checkedAt,
    };

    return Response.json(status);
  } catch (error) {
    const status: SystemStatus = {
      ollamaOnline: false,
      models: [],
      huggingFaceModels,
      checkedAt,
      error:
        error instanceof Error
          ? error.message
          : "Kai Studio could not reach Ollama.",
    };

    return Response.json(status);
  }
}
