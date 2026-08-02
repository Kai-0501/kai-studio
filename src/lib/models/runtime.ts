import { modelRegistry, roleRoutes } from "@/lib/models/config";
import { ollamaProvider } from "@/lib/models/ollama-provider";
import { openAiCompatibleProvider } from "@/lib/models/openai-compatible-provider";
import { geminiProvider } from "@/lib/models/gemini-provider";
import { recordInference } from "@/lib/models/telemetry";
import type { GenerateRequest, GenerateResult, ModelCapability, ModelDefinition, ModelProvider, ModelRole } from "@/lib/models/types";
import { ModelRuntimeError } from "@/lib/models/types";
import { readSettings } from "@/lib/settings-store";
import { ensureHuggingFaceModel } from "@/lib/local-model-runtime";

const providers = new Map<string, ModelProvider>([
  [ollamaProvider.id, ollamaProvider],
  [openAiCompatibleProvider.id, openAiCompatibleProvider],
  [geminiProvider.id, geminiProvider],
]);

export function registerModelProvider(provider: ModelProvider) { providers.set(provider.id, provider); }

export function modelSatisfiesRoute(model: ModelDefinition, capabilities: ModelCapability[], localOnly?: boolean) {
  return model.enabled && (!localOnly || model.provider === "ollama" || model.provider === "openai-compatible") && capabilities.every((capability) => model.capabilities.includes(capability)) && (!capabilities.includes("tools") || model.supportsTools) && (!capabilities.includes("structured-output") || model.supportsStructuredOutput);
}

export async function resolveRole(role: ModelRole, signal?: AbortSignal) {
  const route = roleRoutes[role];
  if (!route) throw new ModelRuntimeError(`No route is configured for ${role}.`, "configuration");
  const settings = await readSettings();
  const assignmentKey = role === "coder.primary" ? "coding" : role.startsWith("security.") ? "security" : role === "editorial.primary" ? "editorial" : role === "vision.extractor" ? "vision" : role === "diagnostics.primary" ? "diagnostics" : role === "diagnostics.parser" ? "diagnosticsParser" : role === "orchestrator.cloud" ? "orchestration" : role === "review.primary" ? "review" : role === "memory.embedding" ? "embedding" : role === "chat.default" ? "chat" : undefined;
  const assignedProviderModel = assignmentKey ? settings.modelAssignments[assignmentKey] : undefined;
  const template = modelRegistry.get(route.primary);
  if (assignedProviderModel && template) {
    const assigned: ModelDefinition = {
      ...template,
      id: `assigned.${assignmentKey}.${assignedProviderModel}`,
      displayName: assignedProviderModel,
      provider: assignedProviderModel.startsWith("hf:") ? "openai-compatible" : assignedProviderModel.startsWith("gemini") ? "gemini" : "ollama",
      providerModel: assignedProviderModel,
      capabilities: [...new Set([...template.capabilities, ...route.requiredCapabilities])],
      supportsTools: template.supportsTools || route.requiredCapabilities.includes("tools"),
      supportsStructuredOutput: template.supportsStructuredOutput || route.requiredCapabilities.includes("structured-output"),
      enabled: true,
    };
    const provider = providers.get(assigned.provider);
    if (assigned.provider === "openai-compatible") {
      await ensureHuggingFaceModel(assigned.providerModel);
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
    const result = await selected.provider.generate(selected.model, request);
    await recordInference({ timestamp: new Date().toISOString(), workflow: request.workflow, role: request.role, modelId: selected.model.id, provider: selected.model.provider, fallbackUsed: selected.fallbackUsed, latencyMs: result.latencyMs, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens, toolCallCount: result.toolCalls.length, retryCount: 0, status: "completed" });
    return result;
  } catch (error) {
    const normalized = error instanceof ModelRuntimeError ? error : new ModelRuntimeError(error instanceof Error ? error.message : "Model inference failed.", "provider", selected?.model.provider);
    await recordInference({ timestamp: new Date().toISOString(), workflow: request.workflow, role: request.role, modelId: selected?.model.id ?? "unresolved", provider: selected?.model.provider ?? "ollama", fallbackUsed: selected?.fallbackUsed ?? false, latencyMs: performance.now() - started, toolCallCount: 0, retryCount: 0, status: "failed", errorCategory: normalized.category });
    throw normalized;
  }
}

export function modelForRole(role: ModelRole) { return modelRegistry.get(roleRoutes[role].primary); }
