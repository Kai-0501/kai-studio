export function isManagedLocalModel(model: string) {
  return model.startsWith("local:") || model.startsWith("hf:");
}

export async function ensureManagedLocalModel(model: string) {
  const response = await fetch("http://127.0.0.1:31416/ensure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(190_000),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(result.error || "The selected local model could not start.");
  }
}

export async function listManagedLocalModels() {
  try {
    const response = await fetch("http://127.0.0.1:31416/models", {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      models?: Array<{ id: string; name: string; size: number; provider?: "huggingface" | "mlx"; canonicalPath?: string; status?: "available" | "candidate" | "unavailable"; statusReason?: string; source?: string; ownership?: string; runtime?: string; family?: string; parameterClass?: string; quantization?: string; architecture?: "dense" | "moe" | "unknown" }>;
    };
    return body.models ?? [];
  } catch {
    return [];
  }
}

export async function setManagedLocalModelRoots(roots: string[]) {
  try {
    await fetch("http://127.0.0.1:31416/roots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roots }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Electron is optional during browser development. Discovery still works in the Next server.
  }
}

/** @deprecated use ensureManagedLocalModel */
export const ensureHuggingFaceModel = ensureManagedLocalModel;
/** @deprecated use listManagedLocalModels */
export const listHuggingFaceModels = listManagedLocalModels;
/** @deprecated user-managed local models are no longer limited to Hugging Face */
export const isHuggingFaceModel = isManagedLocalModel;
