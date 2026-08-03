import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "@/lib/github-build";
import { createExecutionBudget, extendExecutionBudget, stopExecutionForReview, type CodingTaskClass, type ExecutionBudgetSnapshot } from "@/lib/execution-budget";

type TimeDecision = "extend15" | "extend30" | "stop" | "cancel";
type Controller = ExecutionBudgetSnapshot & { buildId: string; jobId?: string; decision?: TimeDecision; resolver?: (decision: TimeDecision) => void };
const globalState = globalThis as typeof globalThis & { __kaiExecutionBudgets?: Map<string, Controller> };
const budgets = globalState.__kaiExecutionBudgets ?? new Map<string, Controller>();
globalState.__kaiExecutionBudgets = budgets;

function stateFile(buildId: string) { return path.join(dataDirectory(), "coding-execution-state", `${buildId}.json`); }

async function persist(state: Controller) {
  await mkdir(path.dirname(stateFile(state.buildId)), { recursive: true });
  await writeFile(stateFile(state.buildId), JSON.stringify({ ...state, resolver: undefined }, null, 2), "utf8");
}

export async function createCodingExecutionBudget(buildId: string, jobId: string | undefined, taskClass: CodingTaskClass, overrideMinutes?: number) {
  const existing = budgets.get(buildId);
  if (existing) return existing;
  const state: Controller = { buildId, ...(jobId ? { jobId } : {}), ...createExecutionBudget(taskClass, overrideMinutes) };
  budgets.set(buildId, state);
  await persist(state);
  return state;
}

export function getCodingExecutionBudget(buildId: string) { return budgets.get(buildId) ?? null; }

export async function replaceCodingExecutionBudget(buildId: string, snapshot: ExecutionBudgetSnapshot) {
  const current = budgets.get(buildId);
  if (!current) return null;
  const next: Controller = { ...current, ...snapshot, buildId, resolver: current.resolver, decision: current.decision };
  budgets.set(buildId, next);
  await persist(next);
  return next;
}

export async function waitForTimeDecision(buildId: string) {
  const state = budgets.get(buildId);
  if (!state) return "stop" as TimeDecision;
  state.paused = true;
  state.awaitingDecision = true;
  state.updatedAt = new Date().toISOString();
  await persist(state);
  if (state.decision) { const decision = state.decision; state.decision = undefined; return decision; }
  return new Promise<TimeDecision>((resolve) => { state.resolver = resolve; });
}

export async function decideCodingExecutionBudget(buildId: string, decision: TimeDecision) {
  const state = budgets.get(buildId);
  if (!state || !state.awaitingDecision) return null;
  let updated: ExecutionBudgetSnapshot;
  if (decision === "extend15") updated = extendExecutionBudget(state, 15);
  else if (decision === "extend30") updated = extendExecutionBudget(state, 30);
  else if (decision === "cancel") updated = { ...stopExecutionForReview(state), cancelled: true };
  else updated = stopExecutionForReview(state);
  Object.assign(state, updated);
  if (state.resolver) { const resolve = state.resolver; state.resolver = undefined; resolve(decision); } else state.decision = decision;
  await persist(state);
  return state;
}

export async function restoreCodingExecutionBudget(buildId: string) {
  const existing = budgets.get(buildId);
  if (existing) return existing;
  try { const saved = JSON.parse(await readFile(stateFile(buildId), "utf8")) as Controller; budgets.set(buildId, saved); return saved; } catch { return null; }
}
