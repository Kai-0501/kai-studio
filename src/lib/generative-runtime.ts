import { randomUUID } from "node:crypto";
import type { ModelDefinition, ModelRole } from "@/lib/models/types";

export type GenerativeRuntimeOwnership = "kai-managed" | "shared-runtime" | "user-managed-external" | "unsupported";
export type GenerativeRuntimeLifecycle = "cold" | "loading" | "warm" | "active" | "idle" | "unloading" | "unavailable";

export type GenerativeLeaseRequest = {
  model: ModelDefinition;
  role: ModelRole;
  workflow: string;
  jobId?: string;
  agentSessionId?: string;
  minimumWarmSeconds?: number;
  idleTimeoutSeconds?: number;
  /**
   * Some specialised runtimes (for example image-only models) cannot be
   * warmed through a text-generation request. Their provider operation owns
   * the initial load instead. Residency is still tracked and released here.
   */
  providerOwnsInitialLoad?: boolean;
};

export type GenerativeRuntimeSnapshot = {
  key: string;
  modelId: string;
  providerModel: string;
  displayName: string;
  provider: ModelDefinition["provider"];
  roleReferences: Partial<Record<ModelRole, number>>;
  rolesSeen: ModelRole[];
  workflowReferences: Record<string, number>;
  jobReferences: Record<string, number>;
  agentSessions: string[];
  ownership: GenerativeRuntimeOwnership;
  lifecycle: GenerativeRuntimeLifecycle;
  leaseCount: number;
  weightsResident: boolean;
  estimatedResidentBytes?: number;
  acquiredAt?: string;
  lastUsedAt?: string;
  unloadAt?: string;
  lastReleaseReason?: string;
  lastError?: string;
};

type RuntimeObservation = { resident: boolean; residentBytes?: number; externallyManaged?: boolean };
export type GenerativeRuntimeAdapter = {
  inspect(model: ModelDefinition): Promise<RuntimeObservation>;
  ensureLoaded(model: ModelDefinition, keepAliveSeconds: number): Promise<RuntimeObservation>;
  unload(model: ModelDefinition): Promise<void>;
  supportsExplicitUnload(model: ModelDefinition): boolean;
};

const ollamaEndpoint = process.env.KAI_OLLAMA_URL ?? "http://127.0.0.1:11434";

function sameOllamaModel(left: string, right: string) {
  const normalise = (value: string) => value.replace(/:latest$/, "");
  return normalise(left) === normalise(right);
}

const defaultAdapter: GenerativeRuntimeAdapter = {
  async inspect(model) {
    if (model.provider !== "ollama") return { resident: false, externallyManaged: true };
    try {
      const response = await fetch(`${ollamaEndpoint}/api/ps`, { signal: AbortSignal.timeout(2500) });
      if (!response.ok) return { resident: false };
      const payload = await response.json() as { models?: Array<{ name?: string; model?: string; size?: number; size_vram?: number }> };
      const resident = payload.models?.find((item) => sameOllamaModel(item.name ?? item.model ?? "", model.providerModel));
      return resident ? { resident: true, residentBytes: resident.size_vram || resident.size } : { resident: false };
    } catch { return { resident: false }; }
  },
  async ensureLoaded(model, keepAliveSeconds) {
    if (model.provider !== "ollama") return { resident: true, externallyManaged: true };
    const response = await fetch(`${ollamaEndpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.providerModel, prompt: "", stream: false, keep_alive: `${Math.max(1, keepAliveSeconds)}s` }),
      signal: AbortSignal.timeout(190_000),
    });
    if (!response.ok) throw new Error((await response.text()).slice(0, 1000) || `Could not load ${model.displayName}.`);
    return this.inspect(model);
  },
  async unload(model) {
    if (model.provider !== "ollama") return;
    const response = await fetch(`${ollamaEndpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.providerModel, prompt: "", stream: false, keep_alive: 0 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error((await response.text()).slice(0, 1000) || `Could not release ${model.displayName}.`);
  },
  supportsExplicitUnload(model) { return model.provider === "ollama"; },
};

type State = GenerativeRuntimeSnapshot & {
  model: ModelDefinition;
  generation: number;
  timer?: ReturnType<typeof setTimeout>;
  minimumWarmSeconds: number;
  idleTimeoutSeconds: number;
  providerOwnsInitialLoad: boolean;
};

export type GenerativeRuntimeLease = {
  id: string;
  key: string;
  snapshot(): GenerativeRuntimeSnapshot;
  release(reason?: string): Promise<void>;
};

/** Reference-counted model-weight residency. Logical sessions and KV caches are tracked separately. */
export class GenerativeRuntimeManager {
  private readonly states = new Map<string, State>();
  private readonly adapter: GenerativeRuntimeAdapter;
  constructor(adapter: GenerativeRuntimeAdapter = defaultAdapter) { this.adapter = adapter; }

  private key(model: ModelDefinition) { return `${model.provider}|${model.endpoint ?? ""}|${model.providerModel}`; }

  async acquire(request: GenerativeLeaseRequest): Promise<GenerativeRuntimeLease> {
    const key = this.key(request.model);
    let state = this.states.get(key);
    if (!state) {
      const observed = await this.adapter.inspect(request.model);
      state = {
        key,
        model: request.model,
        modelId: request.model.id,
        providerModel: request.model.providerModel,
        displayName: request.model.displayName,
        provider: request.model.provider,
        roleReferences: {}, rolesSeen: [], workflowReferences: {}, jobReferences: {}, agentSessions: [],
        ownership: observed.externallyManaged || observed.resident ? "user-managed-external" : this.adapter.supportsExplicitUnload(request.model) ? "kai-managed" : "unsupported",
        lifecycle: observed.resident ? "warm" : "cold",
        leaseCount: 0,
        weightsResident: observed.resident,
        estimatedResidentBytes: observed.residentBytes ?? request.model.estimatedResidentBytes,
        generation: 0,
        minimumWarmSeconds: request.minimumWarmSeconds ?? 30,
        idleTimeoutSeconds: request.idleTimeoutSeconds ?? 120,
        providerOwnsInitialLoad: Boolean(request.providerOwnsInitialLoad),
      };
      this.states.set(key, state);
    }
    if (request.providerOwnsInitialLoad) state.providerOwnsInitialLoad = true;
    if (state.timer) clearTimeout(state.timer);
    state.minimumWarmSeconds = Math.max(state.minimumWarmSeconds, request.minimumWarmSeconds ?? 0);
    state.idleTimeoutSeconds = Math.max(state.idleTimeoutSeconds, request.idleTimeoutSeconds ?? 0);
    if (!state.weightsResident && !request.providerOwnsInitialLoad) {
      state.lifecycle = "loading";
      try {
        const observation = await this.adapter.ensureLoaded(request.model, Math.max(state.minimumWarmSeconds, state.idleTimeoutSeconds));
        state.weightsResident = observation.resident;
        state.estimatedResidentBytes = observation.residentBytes ?? state.estimatedResidentBytes;
        state.lifecycle = observation.resident ? "warm" : "unavailable";
        if (!observation.resident) state.lastError = "The runtime did not confirm model residency.";
      } catch (error) {
        state.lifecycle = "unavailable";
        state.lastError = error instanceof Error ? error.message : "The model could not be loaded.";
        throw error;
      }
    } else if (!state.weightsResident) {
      // Do not send image-only models through /api/generate merely to warm
      // them. The selected provider will load them using its native contract.
      state.lifecycle = "warm";
    }
    state.leaseCount += 1;
    state.roleReferences[request.role] = (state.roleReferences[request.role] ?? 0) + 1;
    if (!state.rolesSeen.includes(request.role)) state.rolesSeen.push(request.role);
    state.workflowReferences[request.workflow] = (state.workflowReferences[request.workflow] ?? 0) + 1;
    if (request.jobId) state.jobReferences[request.jobId] = (state.jobReferences[request.jobId] ?? 0) + 1;
    if (request.agentSessionId && !state.agentSessions.includes(request.agentSessionId)) state.agentSessions.push(request.agentSessionId);
    state.lifecycle = "active";
    state.acquiredAt ??= new Date().toISOString();
    state.lastUsedAt = new Date().toISOString();
    state.unloadAt = undefined;
    const id = randomUUID();
    let released = false;
    return {
      id, key,
      snapshot: () => this.publicSnapshot(state!),
      release: async (reason = "lease-complete") => {
        if (released) return;
        released = true;
        state!.leaseCount = Math.max(0, state!.leaseCount - 1);
        this.decrement(state!.roleReferences, request.role);
        this.decrement(state!.workflowReferences, request.workflow);
        if (request.jobId) this.decrement(state!.jobReferences, request.jobId);
        if (request.agentSessionId && !Object.keys(state!.jobReferences).length) state!.agentSessions = state!.agentSessions.filter((id) => id !== request.agentSessionId);
        state!.lastUsedAt = new Date().toISOString();
        state!.lastReleaseReason = reason;
        if (state!.leaseCount === 0) this.scheduleUnload(state!);
      },
    };
  }

  private decrement(record: Record<string, number>, key: string) {
    if ((record[key] ?? 0) <= 1) delete record[key]; else record[key] -= 1;
  }

  private scheduleUnload(state: State) {
    if (state.timer) clearTimeout(state.timer);
    const delay = Math.max(state.minimumWarmSeconds, state.idleTimeoutSeconds) * 1000;
    state.lifecycle = "idle";
    state.unloadAt = new Date(Date.now() + delay).toISOString();
    const generation = ++state.generation;
    state.timer = setTimeout(() => void this.unloadIfSafe(state.key, generation, "idle-timeout"), delay);
  }

  async unloadIfSafe(key: string, generation?: number, reason = "memory-pressure") {
    const state = this.states.get(key);
    if (!state || state.leaseCount > 0 || (generation !== undefined && generation !== state.generation)) return false;
    if (state.ownership !== "kai-managed" || !this.adapter.supportsExplicitUnload(state.model)) return false;
    state.lifecycle = "unloading";
    try {
      if (state.providerOwnsInitialLoad) {
        // Native image generation owns its own process lifecycle. Do not use
        // the shared text-generation unload endpoint for an image-only model.
        state.lifecycle = "cold";
        state.weightsResident = false;
        state.unloadAt = undefined;
        state.lastReleaseReason = reason;
        return true;
      }
      await this.adapter.unload(state.model);
      state.lifecycle = "cold";
      state.weightsResident = false;
      state.unloadAt = undefined;
      state.lastReleaseReason = reason;
      return true;
    } catch (error) {
      state.lifecycle = "idle";
      state.lastError = error instanceof Error ? error.message : "Model release failed.";
      return false;
    }
  }

  async evictIdle(options: { roles?: ModelRole[]; excludeKeys?: string[]; reason?: string } = {}) {
    const released: string[] = [];
    for (const state of this.states.values()) {
      if (state.leaseCount || state.lifecycle !== "idle" || options.excludeKeys?.includes(state.key)) continue;
      if (options.roles?.length && !options.roles.some((role) => state.rolesSeen.includes(role))) continue;
      if (state.timer) clearTimeout(state.timer);
      if (await this.unloadIfSafe(state.key, undefined, options.reason)) released.push(state.displayName);
    }
    return released;
  }

  snapshots() { return [...this.states.values()].map((state) => this.publicSnapshot(state)); }
  private publicSnapshot(state: State): GenerativeRuntimeSnapshot {
    const snapshot = Object.fromEntries(Object.entries(state).filter(([key]) => !["model", "timer", "generation", "minimumWarmSeconds", "idleTimeoutSeconds", "providerOwnsInitialLoad"].includes(key))) as GenerativeRuntimeSnapshot;
    return structuredClone(snapshot);
  }
  async shutdown() {
    for (const state of this.states.values()) if (state.timer) clearTimeout(state.timer);
    for (const state of this.states.values()) await this.unloadIfSafe(state.key, undefined, "application-shutdown");
  }
}

export const generativeRuntimeManager = new GenerativeRuntimeManager();
