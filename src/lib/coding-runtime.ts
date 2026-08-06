import os from "node:os";
import { embeddingRuntimeManager } from "@/lib/embedding-runtime";
import { generativeRuntimeManager, type GenerativeRuntimeLease } from "@/lib/generative-runtime";
import { resolveRole } from "@/lib/models/runtime";
import { readSettings } from "@/lib/settings-store";
import type { CodingRuntimeSettings } from "@/types/settings";

export type CodingLogicalRole = "planner" | "implementer" | "reviewer";
export type AgentCacheState = "active" | "suspended" | "compacted" | "released" | "unsupported";
export type CodingAgentSessionState = {
  id: string;
  role: CodingLogicalRole;
  status: "pending" | "active" | "checkpointed" | "complete" | "failed";
  contextLimit: 16_384 | 32_768;
  inactiveAgentCachePolicy: CodingRuntimeSettings["inactiveAgentCachePolicy"];
  estimatedContextUse: number;
  kvCache: AgentCacheState;
  checkpointAvailable: boolean;
  lastTransitionAt?: string;
};

export type CodingResidencyPlan = {
  jobId: string;
  mode: CodingRuntimeSettings["executionMode"];
  codingModel: { id: string; displayName: string; providerModel: string; provider: string; estimatedResidentBytes?: number };
  codingEmbedding: string;
  residentModels: Array<{ key: string; displayName: string; ownership: string; references: number; estimatedResidentBytes?: number }>;
  releasableModels: string[];
  mustRemainModels: string[];
  releaseOrder: string[];
  loadOrder: string[];
  contextLimit: 16_384 | 32_768;
  inactiveAgentCachePolicy: CodingRuntimeSettings["inactiveAgentCachePolicy"];
  fallback: CodingRuntimeSettings["memoryPressureFallback"];
  fallbackMode?: string;
  requiresUserDecision: boolean;
  memory: { freeBytes: number; totalBytes: number; estimatedPeakBytes?: number; estimatesExact: boolean };
  warnings: string[];
  createdAt: string;
};

export type CodingRuntimeSnapshot = {
  jobId: string;
  status: "planning" | "running" | "paused" | "complete" | "failed";
  plan: CodingResidencyPlan;
  weightResidency: "loading" | "resident" | "idle" | "released" | "unavailable";
  activeAgent?: CodingLogicalRole;
  sessions: CodingAgentSessionState[];
  codingEmbeddingStatus: string;
  kaiLoreEmbeddingStatus: string;
  modelsReleasedBeforeCoding: string[];
  memoryPressure: "normal" | "elevated" | "unsafe";
  lastRoleTransition?: string;
  nextScheduledRole?: CodingLogicalRole;
  fallbackMode?: string;
  pauseReason?: string;
  updatedAt: string;
};

type JobState = CodingRuntimeSnapshot & { lease: GenerativeRuntimeLease };
const globalRuntime = globalThis as typeof globalThis & { __kaiCodingRuntimeJobs?: Map<string, JobState> };
const jobs = globalRuntime.__kaiCodingRuntimeJobs ?? new Map<string, JobState>();
globalRuntime.__kaiCodingRuntimeJobs = jobs;

export function memoryPressureLevel(freeBytes: number, totalBytes: number) {
  const ratio = totalBytes ? freeBytes / totalBytes : 1;
  return ratio < 0.08 ? "unsafe" as const : ratio < 0.18 ? "elevated" as const : "normal" as const;
}

export function applyMemoryPressurePolicy(input: {
  freeBytes: number;
  totalBytes: number;
  contextLimit: 16_384 | 32_768;
  mode: CodingRuntimeSettings["executionMode"];
  fallback: CodingRuntimeSettings["memoryPressureFallback"];
}) {
  const level = memoryPressureLevel(input.freeBytes, input.totalBytes);
  let contextLimit = input.contextLimit;
  let mode = input.mode;
  let fallbackMode: string | undefined;
  let requiresUserDecision = false;
  if (level !== "normal") {
    if (input.fallback === "pause") {
      requiresUserDecision = true;
      fallbackMode = "Paused before loading the coding model because system memory is constrained.";
    } else if (input.fallback === "single-agent") {
      mode = "single-agent";
      fallbackMode = "Single Agent mode selected by the configured memory-pressure policy.";
    } else if (contextLimit === 32_768) {
      contextLimit = 16_384;
      fallbackMode = "Context reduced from 32K to 16K by the configured memory-pressure policy.";
    } else {
      mode = "single-agent";
      fallbackMode = "16K was already active, so the configured conservative policy selected Single Agent mode.";
    }
  }
  return { level, contextLimit, mode, fallbackMode, requiresUserDecision };
}

export function createCodingAgentSessions(input: {
  jobId: string;
  roles: CodingLogicalRole[];
  contextLimit: 16_384 | 32_768;
  inactiveAgentCachePolicy: CodingRuntimeSettings["inactiveAgentCachePolicy"];
  provider: string;
}): CodingAgentSessionState[] {
  return input.roles.map((role) => ({
    id: `${input.jobId}:${role}`,
    role,
    status: "pending",
    contextLimit: input.contextLimit,
    inactiveAgentCachePolicy: input.inactiveAgentCachePolicy,
    estimatedContextUse: 0,
    kvCache: input.provider === "ollama" ? "released" : "unsupported",
    checkpointAvailable: false,
  }));
}

export function activateCodingAgentSession(input: {
  sessions: CodingAgentSessionState[];
  role: CodingLogicalRole;
  provider: string;
  inactiveAgentCachePolicy: CodingRuntimeSettings["inactiveAgentCachePolicy"];
  estimatedContextUse?: number;
  now?: string;
}) {
  for (const session of input.sessions) {
    if (session.status !== "active") continue;
    session.status = "checkpointed";
    session.checkpointAvailable = true;
    session.kvCache = input.inactiveAgentCachePolicy === "retain-bounded" && input.provider === "ollama" ? "suspended" : "compacted";
  }
  const session = input.sessions.find((item) => item.role === input.role);
  if (!session) throw new Error(`${input.role} is not enabled for this coding job.`);
  session.status = "active";
  session.estimatedContextUse = Math.max(0, input.estimatedContextUse ?? 0);
  session.kvCache = input.provider === "ollama" ? "active" : "unsupported";
  session.lastTransitionAt = input.now ?? new Date().toISOString();
  return session;
}

export async function createCodingResidencyPlan(jobId: string): Promise<CodingResidencyPlan> {
  const [settings, coding] = await Promise.all([readSettings(), resolveRole("coder.primary")]);
  const snapshots = generativeRuntimeManager.snapshots();
  const freeBytes = os.freemem();
  const totalBytes = os.totalmem();
  const policy = applyMemoryPressurePolicy({ freeBytes, totalBytes, contextLimit: settings.codingContextLimit, mode: settings.codingRuntime.executionMode, fallback: settings.codingRuntime.memoryPressureFallback });
  const uncertain = snapshots.some((item) => item.weightsResident && !item.estimatedResidentBytes) || !coding.model.estimatedResidentBytes;
  const releasable = snapshots.filter((item) => item.leaseCount === 0 && item.ownership === "kai-managed" && item.lifecycle === "idle");
  const warnings: string[] = [];
  if (uncertain) warnings.push("Some memory estimates are unavailable; the plan uses conservative pressure checks.");
  if (policy.level !== "normal") warnings.push(policy.fallbackMode ?? "Available system memory is constrained.");
  if (coding.model.provider !== "ollama") warnings.push("This runtime does not expose portable KV-cache controls; inactive sessions will be reconstructed from private checkpoints.");
  return {
    jobId,
    mode: policy.mode,
    codingModel: { id: coding.model.id, displayName: coding.model.displayName, providerModel: coding.model.providerModel, provider: coding.model.provider, ...(coding.model.estimatedResidentBytes ? { estimatedResidentBytes: coding.model.estimatedResidentBytes } : {}) },
    codingEmbedding: settings.modelAssignments.codingEmbedding,
    residentModels: snapshots.filter((item) => item.weightsResident).map((item) => ({ key: item.key, displayName: item.displayName, ownership: item.ownership, references: item.leaseCount, ...(item.estimatedResidentBytes ? { estimatedResidentBytes: item.estimatedResidentBytes } : {}) })),
    releasableModels: releasable.map((item) => item.displayName),
    mustRemainModels: snapshots.filter((item) => item.leaseCount > 0 || item.ownership !== "kai-managed").map((item) => item.displayName),
    releaseOrder: ["Idle KaiLore Embedding", "Idle Coding Embedding", "Inactive reconstructable agent KV cache", "Idle Diagnostics or Orchestration", "Other Kai Studio-owned idle models"],
    loadOrder: ["Configured Coding model", "Coding Embedding only when retrieval begins", "Planner", "Implementer", "Reviewer"],
    contextLimit: policy.contextLimit,
    inactiveAgentCachePolicy: settings.codingRuntime.inactiveAgentCachePolicy,
    fallback: settings.codingRuntime.memoryPressureFallback,
    ...(policy.fallbackMode ? { fallbackMode: policy.fallbackMode } : {}),
    requiresUserDecision: policy.requiresUserDecision,
    memory: { freeBytes, totalBytes, ...(coding.model.estimatedResidentBytes ? { estimatedPeakBytes: coding.model.estimatedResidentBytes } : {}), estimatesExact: !uncertain },
    warnings,
    createdAt: new Date().toISOString(),
  };
}

export class CodingRuntimeCoordinator {
  async start(jobId: string) {
    const existing = jobs.get(jobId);
    if (existing) return this.public(existing);
    const [settings, route, plan] = await Promise.all([readSettings(), resolveRole("coder.primary"), createCodingResidencyPlan(jobId)]);
    if (plan.requiresUserDecision) throw new Error(`${plan.fallbackMode} Change the Coding runtime memory-pressure policy or free memory, then retry.`);
    const released: string[] = [];
    if (settings.codingRuntime.releaseIdleKaiLoreBeforeCoding) {
      const before = embeddingRuntimeManager.snapshots().filter((item) => item.domain === "kailore" && item.lifecycle === "idle" && item.leaseCount === 0).map((item) => item.modelId);
      await embeddingRuntimeManager.evictIdle("kailore");
      released.push(...before);
    }
    await embeddingRuntimeManager.evictIdle("coding");
    if (settings.codingRuntime.releaseIdleDiagnosticsBeforeCoding) released.push(...await generativeRuntimeManager.evictIdle({ roles: ["diagnostics.primary", "diagnostics.parser", "progress.assessor", "orchestrator.cloud"], reason: "pre-coding-safe-release" }));
    const lease = await generativeRuntimeManager.acquire({ model: route.model, role: "coder.primary", workflow: "coding.sequential", jobId, agentSessionId: `${jobId}:weights`, minimumWarmSeconds: 30, idleTimeoutSeconds: settings.codingRuntime.modelIdleTimeoutSeconds });
    const roles: CodingLogicalRole[] = plan.mode === "single-agent" ? ["implementer"] : ["planner", "implementer", "reviewer"];
    const now = new Date().toISOString();
    const state: JobState = {
      jobId, status: "planning", plan, lease,
      weightResidency: "resident",
      sessions: createCodingAgentSessions({ jobId, roles, contextLimit: plan.contextLimit, inactiveAgentCachePolicy: settings.codingRuntime.inactiveAgentCachePolicy, provider: route.model.provider }),
      codingEmbeddingStatus: embeddingRuntimeManager.snapshots().find((item) => item.domain === "coding")?.lifecycle ?? "cold",
      kaiLoreEmbeddingStatus: embeddingRuntimeManager.snapshots().find((item) => item.domain === "kailore")?.lifecycle ?? "cold",
      modelsReleasedBeforeCoding: released,
      memoryPressure: memoryPressureLevel(os.freemem(), os.totalmem()),
      ...(plan.fallbackMode ? { fallbackMode: plan.fallbackMode } : {}),
      nextScheduledRole: roles[0], updatedAt: now,
    };
    jobs.set(jobId, state);
    return this.public(state);
  }

  transition(jobId: string, role: CodingLogicalRole, estimatedContextUse = 0) {
    const state = jobs.get(jobId);
    if (!state) throw new Error("Coding runtime state is unavailable.");
    const session = activateCodingAgentSession({ sessions: state.sessions, role, provider: state.plan.codingModel.provider, inactiveAgentCachePolicy: state.plan.inactiveAgentCachePolicy, estimatedContextUse });
    state.activeAgent = role;
    state.status = "running";
    const transitionAt = session.lastTransitionAt ?? new Date().toISOString();
    state.lastRoleTransition = transitionAt;
    const order: CodingLogicalRole[] = ["planner", "implementer", "reviewer"];
    state.nextScheduledRole = order[order.indexOf(role) + 1];
    state.updatedAt = transitionAt;
    return this.public(state);
  }

  checkpoint(jobId: string, role: CodingLogicalRole, estimatedContextUse = 0) {
    const state = jobs.get(jobId);
    const session = state?.sessions.find((item) => item.role === role);
    if (!state || !session) return;
    session.status = "checkpointed";
    session.checkpointAvailable = true;
    session.estimatedContextUse = estimatedContextUse;
    session.kvCache = "compacted";
    state.updatedAt = new Date().toISOString();
  }

  pause(jobId: string, reason: string) {
    const state = jobs.get(jobId); if (!state) return;
    state.status = "paused"; state.pauseReason = reason; state.updatedAt = new Date().toISOString();
  }

  async stopForReview(jobId: string, reason: string) {
    const state = jobs.get(jobId); if (!state) return;
    for (const session of state.sessions) {
      if (session.status === "active") session.status = "checkpointed";
      if (session.kvCache !== "unsupported") session.kvCache = "released";
    }
    state.status = "paused";
    state.pauseReason = reason;
    state.activeAgent = undefined;
    state.weightResidency = "released";
    state.updatedAt = new Date().toISOString();
    await state.lease.release("coding-job-stopped-for-review");
  }

  async finish(jobId: string, status: "complete" | "failed" = "complete") {
    const state = jobs.get(jobId); if (!state) return;
    for (const session of state.sessions) {
      if (session.status === "active" || session.status === "checkpointed") session.status = status === "complete" ? "complete" : "failed";
      if (session.kvCache !== "unsupported") session.kvCache = "released";
    }
    state.activeAgent = undefined;
    state.status = status;
    state.weightResidency = "idle";
    state.updatedAt = new Date().toISOString();
    await state.lease.release(`coding-job-${status}`);
  }

  snapshot(jobId: string) { const state = jobs.get(jobId); return state ? this.public(state) : undefined; }
  snapshots() { return [...jobs.values()].map((state) => this.public(state)); }
  private public(state: JobState): CodingRuntimeSnapshot {
    const snapshot = Object.fromEntries(Object.entries(state).filter(([key]) => key !== "lease")) as CodingRuntimeSnapshot;
    return structuredClone(snapshot);
  }
}

export const codingRuntimeCoordinator = new CodingRuntimeCoordinator();
