export type CodingTaskClass = "focused_bug_fix" | "small_feature" | "refactor" | "new_subsystem" | "greenfield_application" | "multi_agent_integration";
export type ProgressEventKind = "inspection" | "repository_change" | "subtask_complete" | "tests_improved" | "build_advanced" | "blocker_identified" | "blocker_resolved" | "hypothesis_new" | "hypothesis_rejected" | "review_addressed" | "integration_complete" | "checkpoint" | "rehydration";

export type ProgressEvent = { at: string; kind: ProgressEventKind; fingerprint: string; evidence: string };
export type ResourceSnapshot = { rssBytes: number; rssLimitBytes: number; diskDanger?: boolean; childProcessStuck?: boolean; activeInference?: boolean; tokensPerSecond?: number };
export type ExecutionBudgetSnapshot = {
  taskClass: CodingTaskClass;
  startedAt: string;
  initialBudgetMinutes: number;
  budgetMinutes: number;
  automaticExtensionMinutes: number;
  userExtensionMinutes: number;
  maxAutomaticExtensionMinutes: number;
  softWarningIssued: boolean;
  userNotificationIssued: boolean;
  paused: boolean;
  awaitingDecision: boolean;
  stoppedForReview: boolean;
  cancelled: boolean;
  lastProgressAt: string;
  latestMeaningfulProgress: string;
  phase: string;
  completedPhases: string[];
  progressEvents: ProgressEvent[];
  updatedAt: string;
};

const defaults: Record<CodingTaskClass, number> = {
  focused_bug_fix: 15,
  small_feature: 20,
  refactor: 30,
  new_subsystem: 45,
  greenfield_application: 60,
  multi_agent_integration: 60,
};

export function classifyTask(input: { explicitClass?: CodingTaskClass; greenfield?: boolean; multiAgent?: boolean; phases?: number; changedSubsystems?: number; task?: string }): CodingTaskClass {
  if (input.explicitClass) return input.explicitClass;
  if (input.greenfield) return "greenfield_application";
  if (input.multiAgent) return "multi_agent_integration";
  if ((input.phases ?? 0) >= 4 || (input.changedSubsystems ?? 0) >= 4) return "new_subsystem";
  const task = input.task?.toLowerCase() ?? "";
  if (/refactor|migration|architecture/.test(task)) return "refactor";
  if (/fix|bug|regression/.test(task)) return "focused_bug_fix";
  return "small_feature";
}

export function createExecutionBudget(taskClass: CodingTaskClass, userOverrideMinutes?: number, now = Date.now()): ExecutionBudgetSnapshot {
  const initial = userOverrideMinutes === undefined ? defaults[taskClass] : Math.max(5, Math.min(180, Math.round(userOverrideMinutes)));
  const timestamp = new Date(now).toISOString();
  return { taskClass, startedAt: timestamp, initialBudgetMinutes: initial, budgetMinutes: initial, automaticExtensionMinutes: 0, userExtensionMinutes: 0, maxAutomaticExtensionMinutes: 20, softWarningIssued: false, userNotificationIssued: false, paused: false, awaitingDecision: false, stoppedForReview: false, cancelled: false, lastProgressAt: timestamp, latestMeaningfulProgress: "Execution budget created.", phase: "Implementation", completedPhases: [], progressEvents: [], updatedAt: timestamp };
}

export function recordProgress(state: ExecutionBudgetSnapshot, event: Omit<ProgressEvent, "at">, now = Date.now()) {
  const next = structuredClone(state);
  const progress: ProgressEvent = { ...event, at: new Date(now).toISOString() };
  const duplicate = next.progressEvents.at(-1)?.fingerprint === progress.fingerprint && next.progressEvents.at(-1)?.kind === progress.kind;
  if (!duplicate || progress.kind === "repository_change" || progress.kind === "tests_improved" || progress.kind === "subtask_complete") {
    next.progressEvents.push(progress);
    if (next.progressEvents.length > 60) next.progressEvents.splice(0, next.progressEvents.length - 60);
    next.lastProgressAt = progress.at;
    next.latestMeaningfulProgress = progress.evidence.slice(0, 500);
  }
  next.updatedAt = new Date(now).toISOString();
  return next;
}

export function elapsedMinutes(state: ExecutionBudgetSnapshot, now = Date.now()) {
  return Math.max(0, (now - Date.parse(state.startedAt)) / 60_000);
}

export type BudgetDecision = { action: "continue" | "soft_warning" | "notify" | "auto_extend" | "pause" | "terminate"; reason: string; extensionMinutes?: number };

export function evaluateExecutionBudget(state: ExecutionBudgetSnapshot, resource: ResourceSnapshot, now = Date.now()): BudgetDecision {
  if (state.cancelled) return { action: "terminate", reason: "The user cancelled the job." };
  if (resource.rssBytes > resource.rssLimitBytes || resource.diskDanger || resource.childProcessStuck) return { action: "terminate", reason: "A configured resource guard was activated." };
  if (state.paused || state.awaitingDecision) return { action: "pause", reason: "The execution budget is waiting for a user decision." };
  const elapsed = elapsedMinutes(state, now);
  const progressAge = (now - Date.parse(state.lastProgressAt)) / 60_000;
  const recentProgress = progressAge <= 5;
  const softAt = Math.min(15, state.initialBudgetMinutes * 0.5);
  const notifyAt = Math.min(30, state.initialBudgetMinutes * 0.75);
  if (!state.softWarningIssued && elapsed >= softAt) return { action: "soft_warning", reason: "The coding job reached its soft time checkpoint." };
  if (!state.userNotificationIssued && elapsed >= notifyAt) return { action: "notify", reason: "The coding job reached its visible progress checkpoint." };
  if (elapsed < state.budgetMinutes) return { action: "continue", reason: recentProgress ? "Recent deterministic progress is present." : "The job remains inside its approved execution budget." };
  if (recentProgress && state.automaticExtensionMinutes < state.maxAutomaticExtensionMinutes) return { action: "auto_extend", reason: "Recent deterministic progress supports a bounded continuation.", extensionMinutes: 5 };
  return { action: "pause", reason: recentProgress ? "The automatic continuation ceiling was reached." : "The task reached its time budget without recent deterministic progress." };
}

export function applyBudgetDecision(state: ExecutionBudgetSnapshot, decision: BudgetDecision, now = Date.now()) {
  const next = structuredClone(state);
  if (decision.action === "soft_warning") next.softWarningIssued = true;
  if (decision.action === "notify") next.userNotificationIssued = true;
  if (decision.action === "auto_extend") {
    const minutes = decision.extensionMinutes === 5 ? 5 : 0;
    next.automaticExtensionMinutes += minutes;
    next.budgetMinutes += minutes;
  }
  if (decision.action === "pause") { next.paused = true; next.awaitingDecision = true; }
  next.updatedAt = new Date(now).toISOString();
  return next;
}

export function extendExecutionBudget(state: ExecutionBudgetSnapshot, minutes: 15 | 30, now = Date.now()) {
  const next = structuredClone(state);
  next.budgetMinutes += minutes;
  next.userExtensionMinutes += minutes;
  next.paused = false;
  next.awaitingDecision = false;
  next.stoppedForReview = false;
  next.updatedAt = new Date(now).toISOString();
  return next;
}

export function stopExecutionForReview(state: ExecutionBudgetSnapshot, now = Date.now()) {
  return { ...state, paused: true, awaitingDecision: false, stoppedForReview: true, updatedAt: new Date(now).toISOString() };
}
