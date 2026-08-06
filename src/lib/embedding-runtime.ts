import { randomUUID } from "node:crypto";
import type { EmbeddingRuntimePolicy } from "@/types/settings";

export type EmbeddingRuntimeDomain = "kailore" | "coding" | "conversation";
export type RuntimeOwnership = "kai-managed" | "shared-ollama" | "user-managed-external" | "unsupported";
export type RuntimeLifecycle = "cold" | "loading" | "warm" | "active" | "idle" | "unloading" | "unavailable";

export type EmbeddingRuntimeDescriptor = {
  domain: EmbeddingRuntimeDomain;
  role: "kailore.embedding" | "coding.embedding" | "conversation.embedding";
  modelId: string;
  modelTag?: string;
  revision?: string;
  ownership: RuntimeOwnership;
  runtime?: "ollama" | "mlx" | "llama.cpp" | "external";
  policy: EmbeddingRuntimePolicy;
};

export type EmbeddingRuntimeSnapshot = EmbeddingRuntimeDescriptor & {
  lifecycle: RuntimeLifecycle;
  leaseCount: number;
  acquiredAt?: string;
  lastUsedAt?: string;
  unloadAt?: string;
  lastError?: string;
};

type Adapter = {
  ensureLoaded?: (descriptor: EmbeddingRuntimeDescriptor) => Promise<void>;
  unload?: (descriptor: EmbeddingRuntimeDescriptor) => Promise<void>;
  isAvailable?: (descriptor: EmbeddingRuntimeDescriptor) => Promise<boolean>;
};

const ollamaEndpoint = process.env.KAI_OLLAMA_URL ?? "http://127.0.0.1:11434";
const defaultAdapter: Adapter = {
  async ensureLoaded(descriptor) {
    if (descriptor.ownership !== "shared-ollama" || !descriptor.modelTag) return;
    const response = await fetch(`${ollamaEndpoint}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: descriptor.modelTag }), signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(`Ollama could not resolve ${descriptor.modelTag}.`);
  },
  async isAvailable(descriptor) {
    if (descriptor.ownership !== "shared-ollama" || !descriptor.modelTag) return true;
    const response = await fetch(`${ollamaEndpoint}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: descriptor.modelTag }), signal: AbortSignal.timeout(2500) });
    return response.ok;
  },
  async unload(descriptor) {
    if (descriptor.ownership !== "shared-ollama" || !descriptor.modelTag) return;
    const response = await fetch(`${ollamaEndpoint}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: descriptor.modelTag, prompt: "", stream: false, keep_alive: 0 }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Ollama could not unload ${descriptor.modelTag}.`);
  },
};

type State = EmbeddingRuntimeSnapshot & { timer?: ReturnType<typeof setTimeout>; generation: number };

export type EmbeddingRuntimeLease = {
  id: string;
  snapshot: () => EmbeddingRuntimeSnapshot;
  release: (reason?: string) => Promise<void>;
};

/** Provider-neutral, reference-counted residency manager for embedding roles. */
export class EmbeddingRuntimeManager {
  private readonly states = new Map<string, State>();
  private readonly adapter: Adapter;
  constructor(adapter: Adapter = defaultAdapter) { this.adapter = adapter; }

  private key(d: EmbeddingRuntimeDescriptor) {
    return [d.domain, d.modelId, d.modelTag ?? "", d.revision ?? ""].join("|");
  }

  async acquire(descriptor: EmbeddingRuntimeDescriptor): Promise<EmbeddingRuntimeLease> {
    const key = this.key(descriptor);
    let state = this.states.get(key);
    if (!state) {
      state = { ...descriptor, lifecycle: "cold", leaseCount: 0, generation: 0 };
      this.states.set(key, state);
    }
    if (state.timer) clearTimeout(state.timer);
    if (state.lifecycle !== "active") {
      state.lifecycle = "loading";
      try {
        if (this.adapter.ensureLoaded) await this.adapter.ensureLoaded(descriptor);
        if (this.adapter.isAvailable && !(await this.adapter.isAvailable(descriptor))) {
          state.lifecycle = "unavailable";
          state.lastError = "Assigned embedding runtime is not available.";
        } else state.lifecycle = "warm";
      } catch (error) {
        state.lifecycle = "unavailable";
        state.lastError = error instanceof Error ? error.message : "Embedding runtime could not be loaded.";
      }
    }
    state.leaseCount += 1;
    state.lifecycle = "active";
    state.acquiredAt ??= new Date().toISOString();
    state.lastUsedAt = new Date().toISOString();
    const id = randomUUID();
    let released = false;
    return {
      id,
      snapshot: () => ({ ...state }),
      release: async (reason) => {
        if (released) return;
        released = true;
        state!.leaseCount = Math.max(0, state!.leaseCount - 1);
        state!.lastUsedAt = new Date().toISOString();
        if (reason) state!.lastError = undefined;
        if (state!.leaseCount === 0) this.scheduleUnload(key, state!);
      },
    };
  }

  private scheduleUnload(key: string, state: State) {
    if (state.timer) clearTimeout(state.timer);
    const delay = Math.max(0, state.policy.idleTimeoutSeconds * 1000, state.policy.minimumWarmSeconds * 1000);
    state.lifecycle = "idle";
    state.unloadAt = new Date(Date.now() + delay).toISOString();
    state.generation += 1;
    const generation = state.generation;
    state.timer = setTimeout(() => void this.unloadIfIdle(key, generation), delay);
  }

  private async unloadIfIdle(key: string, generation: number) {
    const state = this.states.get(key);
    if (!state || state.generation !== generation || state.leaseCount > 0) return;
    state.lifecycle = "unloading";
    try {
      if (state.ownership === "shared-ollama" && this.adapter.unload) await this.adapter.unload(state);
      state.lifecycle = "cold";
      state.unloadAt = undefined;
    } catch (error) {
      state.lifecycle = "idle";
      state.lastError = error instanceof Error ? error.message : "Embedding runtime unload failed.";
    }
  }

  async evictIdle(domain?: EmbeddingRuntimeDomain) {
    for (const [key, state] of this.states) {
      if (state.leaseCount || state.lifecycle !== "idle" || (domain && state.domain !== domain) || !state.policy.evictOnMemoryPressure) continue;
      if (state.timer) clearTimeout(state.timer);
      await this.unloadIfIdle(key, state.generation);
    }
  }

  snapshots() { return [...this.states.values()].map((state) => ({ ...state })); }
  async shutdown() { for (const state of this.states.values()) if (state.timer) clearTimeout(state.timer); await this.evictIdle(); }
}

export const embeddingRuntimeManager = new EmbeddingRuntimeManager();

export async function withEmbeddingLease<T>(descriptor: EmbeddingRuntimeDescriptor, operation: () => Promise<T> | T) {
  const lease = await embeddingRuntimeManager.acquire(descriptor);
  try { return await operation(); } finally { await lease.release("operation-complete"); }
}
