import type { SystemStatus } from "@/types/settings";
import { listManagedLocalModels, setManagedLocalModelRoots } from "@/lib/local-model-runtime";
import { discoverLocalModels } from "@/lib/local-model-discovery";
import { readSettings } from "@/lib/settings-store";

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
  const settings = await readSettings();
  await setManagedLocalModelRoots(settings.modelSearchRoots);
  const [managedModels, discoveredModels] = await Promise.all([
    listManagedLocalModels(),
    discoverLocalModels({ extraRoots: settings.modelSearchRoots }),
  ]);
  const huggingFaceModels = managedModels.map((model) => ({
    name: model.id,
    displayName: model.name,
    size: model.size,
    modifiedAt: checkedAt,
    provider: model.provider ?? "huggingface",
    canonicalPath: model.canonicalPath,
    status: model.status ?? "candidate",
    statusReason: model.statusReason,
    source: model.source as import("@/types/settings").LocalModel["source"],
    ownership: model.ownership as import("@/types/settings").LocalModel["ownership"],
    runtime: model.runtime as import("@/types/settings").LocalModel["runtime"],
    family: model.family,
    parameterClass: model.parameterClass,
    quantization: model.quantization,
    architecture: model.architecture,
  }));
  const allDiscovered = [...new Map([...discoveredModels, ...huggingFaceModels].map((model) => [model.canonicalPath ?? model.name, model])).values()];

  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);

    const body = (await response.json()) as OllamaTagsResponse;
    const models = (body.models ?? []).map((model) => ({
        name: model.name,
        size: model.size,
        modifiedAt: model.modified_at,
        provider: "ollama" as const,
      }));

    const status: SystemStatus = {
      ollamaOnline: true,
      models,
      huggingFaceModels,
      discoveredModels: allDiscovered,
      checkedAt,
    };

    return Response.json(status);
  } catch (error) {
    const status: SystemStatus = {
      ollamaOnline: false,
      models: [],
      huggingFaceModels,
      discoveredModels: allDiscovered,
      checkedAt,
      error:
        error instanceof Error
          ? error.message
          : "Kai Studio could not reach Ollama.",
    };

    return Response.json(status);
  }
}
