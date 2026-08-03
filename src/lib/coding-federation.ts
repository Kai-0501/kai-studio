import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { dataDirectory } from "@/lib/github-build";

export type CodingAgentRole = "planner" | "implementer" | "reviewer" | "repair" | "integration";
export type SubtaskStatus = "pending" | "ready" | "active" | "blocked" | "complete";

export type CoordinationSubtask = {
  id: string;
  title: string;
  status: SubtaskStatus;
  ownerAgentId?: string;
  dependencies: string[];
};

export type FileReservation = {
  id: string;
  taskId: string;
  subtaskId: string;
  agentId: string;
  target: string;
  targetType: "file" | "directory" | "subsystem" | "pattern";
  mode: "read" | "write";
  purpose: string;
  repositoryStateId: string;
  leaseStartedAt: string;
  leaseExpiresAt: string;
  renewalCount: number;
};

export type SharedCoordinationState = {
  schemaVersion: 1;
  stateVersion: number;
  taskId: string;
  objective: string;
  approvedScope: string[];
  architectureConstraints: string[];
  acceptanceCriteria: string[];
  taskGraph: CoordinationSubtask[];
  sharedDecisions: string[];
  repositoryStateId: string;
  checkoutId: string;
  reservations: FileReservation[];
  integrationQueue: string[];
  globalTestState: { passing: number; failing: number; lastRunAt?: string; summary?: string };
  crossAgentBlockers: string[];
  userApprovals: string[];
  execution: { activeAgentId?: string; paused: boolean; cancelled: boolean; stepExtensionCount: number; timeExtensionMinutes: number };
  updatedAt: string;
};

export type AgentPrivateCheckpoint = {
  schemaVersion: 1;
  agentId: string;
  role: CodingAgentRole;
  taskId: string;
  assignedSubtasks: string[];
  activeHypothesis: string;
  rejectedHypotheses: string[];
  filesRead: string[];
  filesModified: string[];
  toolsUsed: string[];
  blockers: string[];
  implementationStepCount: number;
  executionBudget: {
    taskClass: string;
    elapsedMinutes: number;
    budgetMinutes: number;
    automaticExtensionMinutes: number;
    userExtensionMinutes: number;
    awaitingDecision: boolean;
  };
  approvals: string[];
  repositoryStateId: string;
  pendingActions: string[];
  compaction: { count: number; lastCompactedAt?: string; contextLimit: 16_384 | 32_768 };
  updatedAt: string;
};

export type CodingHandoff = {
  schemaVersion: 1;
  id: string;
  sourceAgentId: string;
  sourceRole: CodingAgentRole;
  destinationRole: CodingAgentRole;
  taskId: string;
  subtaskId: string;
  repositoryStateId: string;
  objective: string;
  completedActions: string[];
  filesRead: string[];
  filesChanged: string[];
  reservationsHeld: string[];
  reservationsReleased: string[];
  checks: Array<{ name: string; passed: boolean; evidenceReference: string }>;
  decisions: string[];
  assumptions: string[];
  blockers: string[];
  unresolvedRisks: string[];
  nextRecommendedAction: string;
  evidenceToRehydrate: string[];
  acceptanceCriteriaRemaining: string[];
  createdAt: string;
};

export type HandoffAcknowledgement = {
  accepted: boolean;
  schemaValid: boolean;
  repositoryStateValid: boolean;
  missingEvidence: string[];
  reservationConflicts: string[];
  staleState: boolean;
  requiredRehydration: string[];
  unresolvedAmbiguity: string[];
};

function federationDirectory(taskId: string) {
  return path.join(dataDirectory(), "coding-federation", taskId);
}

function coordinationFile(taskId: string) {
  return path.join(federationDirectory(taskId), "coordination.json");
}

function auditFile(taskId: string) {
  return path.join(federationDirectory(taskId), "coordination-events.jsonl");
}

function privateFile(taskId: string, agentId: string) {
  return path.join(federationDirectory(taskId), "agents", `${agentId}.json`);
}

function validateState(state: SharedCoordinationState) {
  if (state.schemaVersion !== 1 || !state.taskId || !Number.isInteger(state.stateVersion) || state.stateVersion < 1) throw new Error("The shared coordination state is invalid.");
  if (JSON.stringify(state).length > 96_000) throw new Error("The shared coordination state exceeded its bounded size.");
  const subtaskIds = new Set(state.taskGraph.map((item) => item.id));
  if (subtaskIds.size !== state.taskGraph.length) throw new Error("The shared task graph contains duplicate IDs.");
  return state;
}

export async function createCoordinationState(input: Omit<SharedCoordinationState, "schemaVersion" | "stateVersion" | "updatedAt" | "reservations" | "integrationQueue" | "globalTestState" | "crossAgentBlockers" | "userApprovals" | "execution">) {
  const state: SharedCoordinationState = validateState({
    schemaVersion: 1,
    stateVersion: 1,
    ...input,
    reservations: [],
    integrationQueue: [],
    globalTestState: { passing: 0, failing: 0 },
    crossAgentBlockers: [],
    userApprovals: [],
    execution: { paused: false, cancelled: false, stepExtensionCount: 0, timeExtensionMinutes: 0 },
    updatedAt: new Date().toISOString(),
  });
  await mkdir(federationDirectory(state.taskId), { recursive: true });
  await writeFile(coordinationFile(state.taskId), JSON.stringify(state, null, 2), "utf8");
  await appendAudit(state.taskId, "created", state.stateVersion, { repositoryStateId: state.repositoryStateId });
  return state;
}

export async function readCoordinationState(taskId: string) {
  return validateState(JSON.parse(await readFile(coordinationFile(taskId), "utf8")) as SharedCoordinationState);
}

async function appendAudit(taskId: string, type: string, stateVersion: number, details: object) {
  await mkdir(federationDirectory(taskId), { recursive: true });
  await appendFile(auditFile(taskId), `${JSON.stringify({ at: new Date().toISOString(), type, stateVersion, details })}\n`, "utf8");
}

export async function updateCoordinationState(taskId: string, expectedVersion: number, update: (state: SharedCoordinationState) => SharedCoordinationState, auditType = "updated") {
  const current = await readCoordinationState(taskId);
  if (current.stateVersion !== expectedVersion) throw new Error(`Shared coordination state conflict: expected version ${expectedVersion}, current version ${current.stateVersion}.`);
  const next = validateState({ ...update(structuredClone(current)), schemaVersion: 1, stateVersion: current.stateVersion + 1, taskId, updatedAt: new Date().toISOString() });
  await writeFile(coordinationFile(taskId), JSON.stringify(next, null, 2), "utf8");
  await appendAudit(taskId, auditType, next.stateVersion, { previousVersion: current.stateVersion, repositoryStateId: next.repositoryStateId });
  return next;
}

function targetsConflict(a: FileReservation, b: FileReservation) {
  if (a.mode !== "write" && b.mode !== "write") return false;
  const left = a.target.replace(/\/$/, "");
  const right = b.target.replace(/\/$/, "");
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export async function reserveTarget(taskId: string, expectedVersion: number, input: Omit<FileReservation, "id" | "leaseStartedAt" | "leaseExpiresAt" | "renewalCount">, leaseMs = 10 * 60_000) {
  const now = Date.now();
  const reservation: FileReservation = { ...input, id: randomUUID(), leaseStartedAt: new Date(now).toISOString(), leaseExpiresAt: new Date(now + leaseMs).toISOString(), renewalCount: 0 };
  const state = await updateCoordinationState(taskId, expectedVersion, (current) => {
    current.reservations = current.reservations.filter((item) => Date.parse(item.leaseExpiresAt) > now);
    const conflict = current.reservations.find((item) => item.agentId !== reservation.agentId && targetsConflict(item, reservation));
    if (conflict) throw new Error(`Reservation conflict with ${conflict.agentId} on ${conflict.target}.`);
    current.reservations = current.reservations.filter((item) => !(item.agentId === reservation.agentId && item.target === reservation.target && item.mode === reservation.mode));
    current.reservations.push(reservation);
    return current;
  }, "reservation-created");
  return { state, reservation };
}

export async function renewReservation(taskId: string, expectedVersion: number, reservationId: string, agentId: string, leaseMs = 10 * 60_000) {
  return updateCoordinationState(taskId, expectedVersion, (state) => {
    const reservation = state.reservations.find((item) => item.id === reservationId && item.agentId === agentId);
    if (!reservation) throw new Error("The reservation is missing, expired, or owned by another agent.");
    reservation.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    reservation.renewalCount += 1;
    return state;
  }, "reservation-renewed");
}

export async function releaseAgentReservations(taskId: string, expectedVersion: number, agentId: string) {
  return updateCoordinationState(taskId, expectedVersion, (state) => {
    state.reservations = state.reservations.filter((item) => item.agentId !== agentId);
    return state;
  }, "reservations-released");
}

export function verifyWriteReservation(state: SharedCoordinationState, agentId: string, target: string, repositoryStateId: string) {
  if (state.repositoryStateId !== repositoryStateId) return { allowed: false, requiresRehydration: true, reason: "Repository state changed after evidence was collected." };
  const now = Date.now();
  const reservation = state.reservations.find((item) => item.agentId === agentId && item.mode === "write" && item.repositoryStateId === repositoryStateId && Date.parse(item.leaseExpiresAt) > now && (item.target === target || target.startsWith(`${item.target.replace(/\/$/, "")}/`)));
  return reservation ? { allowed: true, requiresRehydration: false, reservation } : { allowed: false, requiresRehydration: false, reason: "No active write reservation covers this target." };
}

export async function savePrivateCheckpoint(checkpoint: AgentPrivateCheckpoint) {
  if (!checkpoint.agentId || !checkpoint.taskId || ![16_384, 32_768].includes(checkpoint.compaction.contextLimit)) throw new Error("The private agent checkpoint is invalid.");
  const target = privateFile(checkpoint.taskId, checkpoint.agentId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(checkpoint, null, 2), "utf8");
  return checkpoint;
}

export async function readPrivateCheckpoint(taskId: string, agentId: string) {
  return JSON.parse(await readFile(privateFile(taskId, agentId), "utf8")) as AgentPrivateCheckpoint;
}

export function validateHandoff(value: unknown): CodingHandoff {
  const handoff = value as CodingHandoff;
  if (!handoff || handoff.schemaVersion !== 1 || !handoff.id || !handoff.sourceAgentId || !handoff.taskId || !handoff.subtaskId || !handoff.repositoryStateId || !handoff.objective || !handoff.nextRecommendedAction || !Array.isArray(handoff.evidenceToRehydrate)) throw new Error("The coding handoff is incomplete or malformed.");
  return handoff;
}

export function acknowledgeHandoff(handoffValue: unknown, state: SharedCoordinationState): HandoffAcknowledgement {
  let handoff: CodingHandoff;
  try { handoff = validateHandoff(handoffValue); } catch { return { accepted: false, schemaValid: false, repositoryStateValid: false, missingEvidence: [], reservationConflicts: [], staleState: false, requiredRehydration: [], unresolvedAmbiguity: ["Handoff schema validation failed."] }; }
  const stale = handoff.repositoryStateId !== state.repositoryStateId;
  const conflicts = state.reservations.filter((item) => handoff.reservationsHeld.includes(item.id) && item.agentId !== handoff.sourceAgentId).map((item) => item.target);
  const missingEvidence = handoff.evidenceToRehydrate.filter((item) => !item.trim());
  return { accepted: !stale && !conflicts.length && !missingEvidence.length, schemaValid: true, repositoryStateValid: !stale, missingEvidence, reservationConflicts: conflicts, staleState: stale, requiredRehydration: stale ? handoff.evidenceToRehydrate : [], unresolvedAmbiguity: [] };
}

export function repositoryStateIdentity(input: { checkoutId: string; headCommit: string; dirtyStatus: string; relevantFiles?: Array<{ path: string; content: string }> }) {
  const hash = createHash("sha256");
  hash.update(input.checkoutId);
  hash.update("\0");
  hash.update(input.headCommit);
  hash.update("\0");
  hash.update(input.dirtyStatus);
  for (const file of [...(input.relevantFiles ?? [])].sort((a, b) => a.path.localeCompare(b.path))) hash.update(`\0${file.path}\0${file.content}`);
  return hash.digest("hex");
}

export class SequentialAgentScheduler {
  private cursor = 0;
  private readonly agents: Array<{ id: string; role: CodingAgentRole }>;
  constructor(agents: Array<{ id: string; role: CodingAgentRole }>) {
    if (!agents.length) throw new Error("At least one logical coding agent is required.");
    if (new Set(agents.map((agent) => agent.id)).size !== agents.length) throw new Error("Logical agent IDs must be unique.");
    this.agents = agents;
  }
  next(eligibleIds?: Set<string>) {
    for (let inspected = 0; inspected < this.agents.length; inspected += 1) {
      const candidate = this.agents[this.cursor % this.agents.length];
      this.cursor = (this.cursor + 1) % this.agents.length;
      if (!eligibleIds || eligibleIds.has(candidate.id)) return candidate;
    }
    return null;
  }
}
