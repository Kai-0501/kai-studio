import { appendFile, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { dataDirectory, type CheckResult } from "@/lib/github-build";
import type { AgentAction } from "@/lib/coding-agent";
import type { CanonicalMessage } from "@/lib/models/types";
import { createContextBudget, contextDiagnostics, shouldCompactContext, type ContextLimit } from "@/lib/coding-context-budget";
import type { SharedCoordinationState } from "@/lib/coding-federation";

type WorkingEvent = {
  at: string;
  taskId: string;
  agentId: string;
  subtaskId?: string;
  repositoryStateId: string;
  outcome: "success" | "failure" | "informational";
  eventType: "tool" | "feedback" | "note" | "checkpoint";
  action?: AgentAction;
  result?: string;
  checks?: CheckResult[];
  feedback?: string;
  note?: string;
};

export type CodingWarmCheckpoint = {
  version: 2;
  taskId: string;
  agentId: string;
  role: "planner" | "implementer" | "reviewer" | "repair" | "integration";
  objective: string;
  approvedScope: string;
  completedSubtasks: string[];
  remainingSubtasks: string[];
  filesRead: string[];
  filesModified: string[];
  repositoryStateId: string;
  latestChecks: CheckResult[];
  blockers: string[];
  activeHypothesis: string;
  rejectedHypotheses: string[];
  userApprovals: string[];
  extensionState: { implementationSteps: number; stepLimit: number; extensionCount: number; awaitingExtension: boolean; elapsedMinutes?: number; executionBudgetMinutes?: number; automaticExtensionMinutes?: number; userExtensionMinutes?: number; awaitingTimeDecision?: boolean };
  context: { limit: ContextLimit; estimatedUse: number; compactionThreshold: number; compactionCount: number; lastCompactedAt?: string; evidenceOmitted: number; remainingResponseHeadroom: number };
  nextRecommendedAction: string;
};

/**
 * Three-tier working memory for bounded coding loops.
 * Hot: recent exact turns sent to the model.
 * Warm: structured action/file/check ledger sent as a compact checkpoint.
 * Cold: the complete lossless event stream persisted on disk for auditing.
 */
export class CodingWorkingMemory {
  private readonly base: CanonicalMessage[];
  private readonly taskId: string;
  private readonly agentId: string;
  private readonly subtaskId: string;
  private hot: CanonicalMessage[] = [];
  private actions: string[] = [];
  private filesRead = new Set<string>();
  private exactHotFiles = new Set<string>();
  private files = new Set<string>();
  private latestChecks: CheckResult[] = [];
  private blockers: string[] = [];
  private readonly logFile: string;
  private toolResultCount = 0;
  private turnCount = 0;
  private compactionCount = 0;
  private lastCompactedAt?: string;
  private omittedEvidence = 0;
  private repositoryStateId = "runtime-state";
  private readonly budget;

  private constructor(base: CanonicalMessage[], taskId: string, agentId: string, subtaskId: string, contextLimit: ContextLimit) {
    this.base = base;
    this.taskId = taskId;
    this.agentId = agentId;
    this.subtaskId = subtaskId;
    this.logFile = path.join(dataDirectory(), "coding-working-memory", taskId, "events.jsonl");
    this.budget = createContextBudget(contextLimit);
  }

  static async create(base: CanonicalMessage[], buildId: string, options: { agentId?: string; subtaskId?: string; contextLimit?: ContextLimit; repositoryStateId?: string } = {}) {
    const memory = new CodingWorkingMemory(base, buildId, options.agentId ?? "implementer-1", options.subtaskId ?? "implement", options.contextLimit ?? 32_768);
    memory.repositoryStateId = options.repositoryStateId ?? "runtime-state";
    await mkdir(path.dirname(memory.logFile), { recursive: true });
    await open(memory.logFile, "a").then((handle) => handle.close());
    return memory;
  }

  async record(action: AgentAction, result: string, checks?: CheckResult[], image?: string) {
    const event: WorkingEvent = { at: new Date().toISOString(), taskId: this.taskId, agentId: this.agentId, subtaskId: this.subtaskId, repositoryStateId: this.repositoryStateId, outcome: checks?.some((check) => !check.passed) ? "failure" : "success", eventType: "tool", action, result, checks };
    await appendFile(this.logFile, `${JSON.stringify(event)}\n`, "utf8");
    this.actions.push(`${action.tool}: ${action.status}`);
    if (this.actions.length > 24) this.actions.shift();
    if (action.tool === "read_file") { this.filesRead.add(action.path); this.exactHotFiles.add(action.path); }
    if (action.tool === "write_file") this.files.add(action.path);
    if (checks) this.latestChecks = checks;
    this.toolResultCount += 1;
    this.turnCount += 1;
    this.hot.push({ role: "assistant", content: JSON.stringify(action) });
    this.hot.push({ role: "user", content: image
      ? [{ type: "text", text: `Tool result:\n${result.slice(0, 40_000)}` }, { type: "image", data: image, mimeType: "image/png" }]
      : `Tool result:\n${result.slice(0, 40_000)}` });
    this.trimHot();
    await this.maybeCompact();
  }

  async feedback(action: AgentAction, feedback: string) {
    await appendFile(this.logFile, `${JSON.stringify({ at: new Date().toISOString(), taskId: this.taskId, agentId: this.agentId, subtaskId: this.subtaskId, repositoryStateId: this.repositoryStateId, outcome: "failure", eventType: "feedback", action, feedback } satisfies WorkingEvent)}\n`, "utf8");
    this.blockers.push(feedback.slice(0, 3_000));
    if (this.blockers.length > 5) this.blockers.shift();
    this.hot.push({ role: "assistant", content: JSON.stringify(action) }, { role: "user", content: feedback });
    this.trimHot();
    await this.maybeCompact();
  }

  async note(note: string) {
    await appendFile(this.logFile, `${JSON.stringify({ at: new Date().toISOString(), taskId: this.taskId, agentId: this.agentId, subtaskId: this.subtaskId, repositoryStateId: this.repositoryStateId, outcome: "informational", eventType: "note", note } satisfies WorkingEvent)}\n`, "utf8");
    this.hot.push({ role: "system", content: `RUNTIME NOTE: ${note}` });
    this.trimHot();
  }

  async checkpoint(extensionState?: CodingWarmCheckpoint["extensionState"]) {
    const checkpoint = this.warmCheckpoint(extensionState);
    await appendFile(this.logFile, `${JSON.stringify({ at: new Date().toISOString(), taskId: this.taskId, agentId: this.agentId, subtaskId: this.subtaskId, repositoryStateId: this.repositoryStateId, outcome: "success", eventType: "checkpoint", note: JSON.stringify(checkpoint) } satisfies WorkingEvent)}\n`, "utf8");
  }

  warmCheckpoint(extensionState: CodingWarmCheckpoint["extensionState"] = { implementationSteps: 0, stepLimit: 150, extensionCount: 0, awaitingExtension: false }): CodingWarmCheckpoint {
    const firstUser = this.base.find((message) => message.role === "user")?.content;
    const diagnostics = this.diagnostics();
    return { version: 2, taskId: this.taskId, agentId: this.agentId, role: "implementer", objective: typeof firstUser === "string" ? firstUser : "", approvedScope: "User-approved coding task", completedSubtasks: [...this.actions], remainingSubtasks: [], filesRead: [...this.filesRead], filesModified: [...this.files], repositoryStateId: this.repositoryStateId, latestChecks: [...this.latestChecks], blockers: [...this.blockers], activeHypothesis: "Inspect current evidence before changing code", rejectedHypotheses: [], userApprovals: [], extensionState, context: { limit: this.budget.limit, estimatedUse: diagnostics.estimatedContextUse, compactionThreshold: this.budget.compactionThreshold, compactionCount: this.compactionCount, ...(this.lastCompactedAt ? { lastCompactedAt: this.lastCompactedAt } : {}), evidenceOmitted: this.omittedEvidence, remainingResponseHeadroom: diagnostics.remainingResponseHeadroom }, nextRecommendedAction: "Inspect the next relevant subsystem or run the next declared check" };
  }

  async retrieveColdEvents(query: string, limit = 12, filters: { taskId?: string; agentId?: string; subtaskId?: string; filePath?: string; tool?: string; eventType?: WorkingEvent["eventType"]; outcome?: WorkingEvent["outcome"]; repositoryStateId?: string; before?: string; after?: string } = {}) {
    const handle = await open(this.logFile, "r").catch(() => null);
    if (!handle) return [];
    const info = await handle.stat();
    const size = Math.min(info.size, 512_000);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, info.size - size);
    await handle.close();
    let content = buffer.toString("utf8");
    if (info.size > size) content = content.replace(/^[^\n]*\n/, "");
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const candidates = content.split("\n").filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as WorkingEvent]; } catch { return []; }
    }).filter((event) => (!filters.taskId || event.taskId === filters.taskId) && event.agentId === (filters.agentId ?? this.agentId) && (!filters.subtaskId || event.subtaskId === filters.subtaskId) && (!filters.filePath || JSON.stringify(event).includes(filters.filePath)) && (!filters.tool || event.action?.tool === filters.tool) && (!filters.eventType || event.eventType === filters.eventType) && (!filters.outcome || event.outcome === filters.outcome) && (!filters.repositoryStateId || event.repositoryStateId === filters.repositoryStateId) && (!filters.before || event.at <= filters.before) && (!filters.after || event.at >= filters.after)).map((event) => ({ event, score: terms.reduce((score, term) => score + (JSON.stringify(event).toLocaleLowerCase().includes(term) ? 1 : 0), 0) })).filter((item) => !terms.length || item.score > 0).sort((a, b) => b.score - a.score || b.event.at.localeCompare(a.event.at)).slice(0, Math.min(limit, 40));
    return candidates.sort((a, b) => a.event.at.localeCompare(b.event.at)).map(({ event }) => ({ ...event, staleHistoricalState: event.repositoryStateId !== this.repositoryStateId }));
  }

  context(coordination?: SharedCoordinationState): CanonicalMessage[] {
    const sharedCoordination: CanonicalMessage | null = coordination ? {
      role: "system",
      content: `SHARED COORDINATION STATE (trusted, bounded, version ${coordination.stateVersion})\nObjective: ${coordination.objective}\nRepository revision: ${coordination.repositoryStateId}\nTask graph:\n${coordination.taskGraph.map((item) => `${item.id}: ${item.status}${item.ownerAgentId ? ` (${item.ownerAgentId})` : ""}`).join("\n")}\nShared decisions:\n${coordination.sharedDecisions.join("\n") || "None"}\nCross-agent blockers:\n${coordination.crossAgentBlockers.join("\n") || "None"}\nActive write reservations:\n${coordination.reservations.filter((item) => Date.parse(item.leaseExpiresAt) > Date.now()).map((item) => `${item.agentId}: ${item.target}`).join("\n") || "None"}`,
    } : null;
    if (!this.actions.length) return [...this.base, ...(sharedCoordination ? [sharedCoordination] : [])];
    const checkpoint: CanonicalMessage = {
      role: "system",
      content: `CODING SESSION CHECKPOINT (trusted runtime summary)\nCompleted actions:\n${this.actions.join("\n")}\n\nFiles written:\n${[...this.files].join("\n") || "None"}\n\nLatest checks:\n${this.latestChecks.map((check) => `${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.output.slice(-1_500)}`).join("\n") || "Not run yet"}\n\nActive blockers or reviewer feedback:\n${this.blockers.join("\n---\n") || "None"}\n\nOlder raw tool output is archived on disk to avoid KV-cache growth. Re-read a file or rerun a check whenever exact evidence is needed; never guess from this checkpoint.`,
    };
    return [...this.base, ...(sharedCoordination ? [sharedCoordination] : []), checkpoint, ...this.hot];
  }

  setRepositoryStateId(repositoryStateId: string) { this.repositoryStateId = repositoryStateId; }

  hasReadCurrentFile(filePath: string) { return this.exactHotFiles.has(filePath); }

  diagnostics() {
    return contextDiagnostics(this.budget, { instructions: this.base.filter((message) => message.role === "system"), task: this.base.filter((message) => message.role === "user"), evidence: this.hot, coordination: "", warm: this.actions, recentTools: this.hot, headroom: "" });
  }

  private async maybeCompact() {
    if (!shouldCompactContext(this.budget, { instructions: this.base, task: this.base, evidence: this.hot, warm: this.actions, recentTools: this.hot, headroom: "" }, this.toolResultCount, this.turnCount)) return;
    const removed = Math.max(0, this.hot.length - 4);
    if (removed) this.hot.splice(0, removed);
    if (removed) this.exactHotFiles.clear();
    this.omittedEvidence += removed;
    this.compactionCount += 1;
    this.lastCompactedAt = new Date().toISOString();
    this.toolResultCount = Math.min(this.toolResultCount, 4);
    this.turnCount = 0;
    const checkpoint = this.warmCheckpoint();
    await appendFile(this.logFile, `${JSON.stringify({ at: this.lastCompactedAt, taskId: this.taskId, agentId: this.agentId, subtaskId: this.subtaskId, repositoryStateId: this.repositoryStateId, outcome: "success", eventType: "checkpoint", note: JSON.stringify(checkpoint) } satisfies WorkingEvent)}\n`, "utf8");
  }

  private trimHot() {
    const maxMessages = 8;
    const maxCharacters = 120_000;
    while (this.hot.length > maxMessages || this.hot.reduce((sum, message) => sum + (typeof message.content === "string" ? message.content.length : JSON.stringify(message.content).length), 0) > maxCharacters) {
      this.hot.splice(0, Math.min(2, this.hot.length));
      this.exactHotFiles.clear();
    }
  }
}
