import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "@/lib/github-build";
import { EXTENSION_STEPS, PAUSE_STEP } from "@/lib/coding-loop-policy";

export type CodingLoopSnapshot = {
  buildId: string;
  jobId?: string;
  implementationStepCount: number;
  inspectionCount: number;
  stepLimit: number;
  extensionCount: number;
  paused: boolean;
  awaitingExtension: boolean;
  stopRequested: boolean;
  createdAt: string;
  updatedAt: string;
};

type Decision = "extend" | "stop";
type Controller = CodingLoopSnapshot & { decision?: Decision; resolver?: (decision: Decision) => void };

const globalState = globalThis as typeof globalThis & { __kaiCodingLoops?: Map<string, Controller> };
const loops = globalState.__kaiCodingLoops ?? new Map<string, Controller>();
globalState.__kaiCodingLoops = loops;

function stateFile(buildId: string) {
  return path.join(dataDirectory(), "coding-loop-state", `${buildId}.json`);
}

async function persist(state: Controller) {
  await mkdir(path.dirname(stateFile(state.buildId)), { recursive: true });
  await writeFile(stateFile(state.buildId), JSON.stringify({ ...state, resolver: undefined }, null, 2), "utf8");
}

export async function createCodingLoop(buildId: string, jobId?: string, initialSteps = 0) {
  const existing = loops.get(buildId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const state: Controller = {
    buildId,
    ...(jobId ? { jobId } : {}),
    implementationStepCount: initialSteps,
    inspectionCount: 0,
    stepLimit: PAUSE_STEP,
    extensionCount: 0,
    paused: false,
    awaitingExtension: false,
    stopRequested: false,
    createdAt: now,
    updatedAt: now,
  };
  loops.set(buildId, state);
  await persist(state);
  return state;
}

export function getCodingLoop(buildId: string) {
  return loops.get(buildId) ?? null;
}

export async function recordCodingAction(buildId: string, counted: boolean) {
  const state = loops.get(buildId);
  if (!state) return null;
  if (counted) state.implementationStepCount += 1;
  else state.inspectionCount += 1;
  state.updatedAt = new Date().toISOString();
  await persist(state);
  return state;
}

export async function noteCheckpoint(buildId: string) {
  const state = loops.get(buildId);
  if (!state) return null;
  state.updatedAt = new Date().toISOString();
  // Keep the durable snapshot valid JSON. The warm-memory ledger remains the
  // source of checkpoint details; this file only tracks resumable loop state.
  await persist(state);
  return state;
}

export async function waitForExtension(buildId: string) {
  const state = loops.get(buildId);
  if (!state) return "stop" as Decision;
  state.paused = true;
  state.awaitingExtension = true;
  state.updatedAt = new Date().toISOString();
  await persist(state);
  if (state.decision) {
    const decision = state.decision;
    state.decision = undefined;
    return decision;
  }
  return new Promise<Decision>((resolve) => { state.resolver = resolve; });
}

export async function decideCodingLoop(buildId: string, decision: Decision) {
  const state = loops.get(buildId);
  if (!state || !state.awaitingExtension) return null;
  if (decision === "extend") {
    state.extensionCount += 1;
    state.stepLimit += EXTENSION_STEPS;
  } else {
    state.stopRequested = true;
  }
  state.paused = false;
  state.awaitingExtension = false;
  state.updatedAt = new Date().toISOString();
  if (state.resolver) {
    const resolve = state.resolver;
    state.resolver = undefined;
    resolve(decision);
  } else {
    state.decision = decision;
  }
  await persist(state);
  return state;
}

export async function restoreCodingLoop(buildId: string) {
  const current = loops.get(buildId);
  if (current) return current;
  try {
    const saved = JSON.parse(await readFile(stateFile(buildId), "utf8")) as Controller;
    loops.set(buildId, saved);
    return saved;
  } catch {
    return null;
  }
}
