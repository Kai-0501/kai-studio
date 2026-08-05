import { modelRegistry, roleRoutes } from "@/lib/models/config";
import { ollamaProvider } from "@/lib/models/ollama-provider";
import { openAiCompatibleProvider } from "@/lib/models/openai-compatible-provider";
import { geminiProvider } from "@/lib/models/gemini-provider";
import { recordInference } from "@/lib/models/telemetry";
import type { GenerateRequest, GenerateResult, ImageGenerationRequest, ImageGenerationResult, ModelCapability, ModelDefinition, ModelProvider, ModelRole } from "@/lib/models/types";
import { ModelRuntimeError } from "@/lib/models/types";
import { readSettings } from "@/lib/settings-store";
import { ensureManagedLocalModel, isManagedLocalModel } from "@/lib/local-model-runtime";
import type { ModelAssignments } from "@/types/settings";
import { generativeRuntimeManager } from "@/lib/generative-runtime";

const providers = new Map<string, ModelProvider>([
  [ollamaProvider.id, ollamaProvider],
  [openAiCompatibleProvider.id, openAiCompatibleProvider],
  [geminiProvider.id, geminiProvider],
]);

export function registerModelProvider(provider: ModelProvider) { providers.set(provider.id, provider); }

const assignmentKeyByRole: Partial<Record<ModelRole, keyof ModelAssignments>> = {
  "coder.primary": "coding",
  "security.preflight": "security",
  "security.postflight": "security",
  "editorial.primary": "editorial",
  "vision.extractor": "vision",
  "vision.reviewer": "vision",
  "image.planner": "imagePlanner",
  "image.generator": "image",
  "diagnostics.primary": "diagnostics",
  "diagnostics.parser": "diagnosticsParser",
  "progress.assessor": "progressAssessor",
  "orchestrator.cloud": "orchestration",
  "review.primary": "review",
  "kailore.embedding": "kaiLoreEmbedding",
  "coding.embedding": "codingEmbedding",
  "chat.default": "chat",
};

export function modelSatisfiesRoute(model: ModelDefinition, capabilities: ModelCapability[], localOnly?: boolean) {
  return model.enabled && (!localOnly || model.provider === "ollama" || model.provider === "openai-compatible") && capabilities.every((capability) => model.capabilities.includes(capability)) && (!capabilities.includes("tools") || model.supportsTools) && (!capabilities.includes("structured-output") || model.supportsStructuredOutput);
}

export async function resolveRole(role: ModelRole, signal?: AbortSignal) {
  const route = roleRoutes[role];
  if (!route) throw new ModelRuntimeError(`No route is configured for ${role}.`, "configuration");
  const settings = await readSettings();
  const assignmentKey = assignmentKeyByRole[role];
  const assignedProviderModel = assignmentKey ? settings.modelAssignments[assignmentKey] : undefined;
  const template = modelRegistry.get(route.primary);
  if (assignedProviderModel && template) {
    const isEmbeddingRole = role === "kailore.embedding" || role === "coding.embedding";
    // Embedding is intentionally capability-specific. A generative model may be
    // selected in Settings for a future adapter, but it must not be treated as
    // an embedding runtime until that adapter explicitly declares support.
    if (isEmbeddingRole && !["local-hash", "local.memory-hash-embedding"].includes(assignedProviderModel)) {
      throw new ModelRuntimeError(
        `${assignedProviderModel} cannot be assigned to ${assignmentKey} until a compatible embedding adapter is installed. Kai Studio will use lexical retrieval where available.`,
        "configuration",
      );
    }
    const assigned: ModelDefinition = {
      ...template,
      id: `assigned.${assignmentKey}.${assignedProviderModel}`,
      displayName: assignedProviderModel,
      provider: isManagedLocalModel(assignedProviderModel) ? "openai-compatible" : assignedProviderModel.startsWith("gemini") ? "gemini" : "ollama",
      providerModel: assignedProviderModel,
      endpoint: isManagedLocalModel(assignedProviderModel) ? "http://127.0.0.1:11435/v1" : template.endpoint,
      capabilities: [...new Set([...template.capabilities, ...route.requiredCapabilities])],
      supportsTools: template.supportsTools || route.requiredCapabilities.includes("tools"),
      supportsStructuredOutput: template.supportsStructuredOutput || route.requiredCapabilities.includes("structured-output"),
      enabled: true,
    };
    const provider = providers.get(assigned.provider);
    if (assigned.provider === "openai-compatible") {
      await ensureManagedLocalModel(assigned.providerModel);
    }
    if (provider && modelSatisfiesRoute(assigned, route.requiredCapabilities, route.localOnly) && await provider.health(assigned, signal)) {
      return { model: assigned, provider, fallbackUsed: false };
    }
    throw new ModelRuntimeError(`The model assigned to ${assignmentKey} is unavailable: ${assignedProviderModel}.`, "unavailable");
  }
  const ids = [route.primary, ...(route.fallbacks ?? [])];
  for (let index = 0; index < ids.length; index += 1) {
    const model = modelRegistry.get(ids[index]);
    if (!model || !modelSatisfiesRoute(model, route.requiredCapabilities, route.localOnly)) continue;
    const provider = providers.get(model.provider);
    if (!provider) continue;
    if (await provider.health(model, signal)) return { model, provider, fallbackUsed: index > 0 };
  }
  throw new ModelRuntimeError(`No healthy configured model satisfies role ${role} (${route.requiredCapabilities.join(", ")}).`, "unavailable");
}

export async function generateForRole(request: GenerateRequest): Promise<GenerateResult> {
  const started = performance.now();
  let selected: Awaited<ReturnType<typeof resolveRole>> | undefined;
  try {
    selected = await resolveRole(request.role, request.signal);
    const settings = await readSettings();
    const lease = await generativeRuntimeManager.acquire({
      model: selected.model,
      role: request.role,
      workflow: request.workflow,
      minimumWarmSeconds: request.role === "coder.primary" ? 30 : 10,
      idleTimeoutSeconds: request.role === "coder.primary" ? settings.codingRuntime.modelIdleTimeoutSeconds : 90,
    });
    let result: GenerateResult;
    try {
      result = await selected.provider.generate(selected.model, request);
    } finally {
      await lease.release("inference-complete");
    }
    await recordInference({ timestamp: new Date().toISOString(), workflow: request.workflow, role: request.role, modelId: selected.model.id, provider: selected.model.provider, fallbackUsed: selected.fallbackUsed, latencyMs: result.latencyMs, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens, toolCallCount: result.toolCalls.length, retryCount: 0, status: "completed" });
    return result;
  } catch (error) {
    const normalized = error instanceof ModelRuntimeError ? error : new ModelRuntimeError(error instanceof Error ? error.message : "Model inference failed.", "provider", selected?.model.provider);
    await recordInference({ timestamp: new Date().toISOString(), workflow: request.workflow, role: request.role, modelId: selected?.model.id ?? "unresolved", provider: selected?.model.provider ?? "ollama", fallbackUsed: selected?.fallbackUsed ?? false, latencyMs: performance.now() - started, toolCallCount: 0, retryCount: 0, status: "failed", errorCategory: normalized.category });
    throw normalized;
  }
}

/** Image generation uses the same registry, availability checks, and runtime
 * leases as language inference. Components never choose a provider directly. */
export async function generateImageForRole(role: "image.generator", request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const selected = await resolveRole(role, request.signal);
  if (!selected.provider.generateImage) throw new ModelRuntimeError(`The configured image provider (${selected.model.provider}) cannot generate images.`, "capability", selected.model.provider);
  const lease = await generativeRuntimeManager.acquire({ model: selected.model, role, workflow: "kai-studio.image-generation", minimumWarmSeconds: 10, idleTimeoutSeconds: 90 });
  try {
    return await selected.provider.generateImage(selected.model, request);
  } finally {
    await lease.release("image-generation-complete");
  }
}

export function modelForRole(role: ModelRole) { return modelRegistry.get(roleRoutes[role].primary); }
