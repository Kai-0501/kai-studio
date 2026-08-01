export const huggingFaceModelId = "hf:gemma4-26b-a4b-q4";

export function isHuggingFaceModel(model: string) {
  return model.startsWith("hf:");
}

export async function ensureHuggingFaceModel(model: string) {
  const response = await fetch("http://127.0.0.1:31416/ensure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(190_000),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(result.error || "The local Hugging Face model could not start.");
  }
}

export async function listHuggingFaceModels() {
  try {
    const response = await fetch("http://127.0.0.1:31416/models", {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      models?: Array<{ id: string; name: string; size: number }>;
    };
    return body.models ?? [];
  } catch {
    return [];
  }
}
