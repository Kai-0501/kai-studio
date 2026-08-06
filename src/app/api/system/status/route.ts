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

export function mapOllamaTagModels(body: OllamaTagsResponse) {
  return (body.models ?? []).map((model) => ({
    name: model.name,
    size: model.size,
    modifiedAt: model.modified_at,
    capabilities: Array.isArray(model.capabilities) ? [...model.capabilities] : undefined,
    provider: "ollama" as const,
  }));
}

export function builtInModels(checkedAt: string): SystemStatus["models"] {
  return [{
    name: "local-hash",
    displayName: "Local Memory Embeddings",
    size: 0,
    modifiedAt: checkedAt,
    capabilities: ["embedding"],
    provider: "manual",
    source: "manual-registration",
    ownership: "kai-managed",
    runtime: "external",
    status: "available",
    statusReason: "Built into Kai Studio; no external runtime is required.",
  }];
}

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
  const allDiscovered = [...new Map([...builtInModels(checkedAt), ...discoveredModels, ...huggingFaceModels].map((model) => [model.canonicalPath ?? model.name, model])).values()];

  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);

    const body = (await response.json()) as OllamaTagsResponse;
    // This is intentionally fresh on every scan. Runtime capability validation
    // uses `/api/show` again at execution time, so a changed Ollama model can
    // never be accepted from stale startup metadata.
    const models = mapOllamaTagModels(body);

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
