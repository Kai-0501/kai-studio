import type { CodingAgentRole, AgentPrivateCheckpoint, SharedCoordinationState } from "@/lib/coding-federation";
import type { CanonicalMessage } from "@/lib/models/types";

export type ContextLimit = 16_384 | 32_768;
export type ContextSection = "instructions" | "task" | "evidence" | "coordination" | "warm" | "recentTools" | "headroom";
export type ContextBudget = {
  limit: ContextLimit;
  compactionThreshold: number;
  allocations: Record<ContextSection, number>;
};

const ratios: Record<ContextSection, number> = {
  instructions: 0.12,
  task: 0.10,
  evidence: 0.30,
  coordination: 0.10,
  warm: 0.10,
  recentTools: 0.10,
  headroom: 0.18,
};

export function createContextBudget(limit: ContextLimit, compactionThreshold = 0.78): ContextBudget {
  if (![16_384, 32_768].includes(limit)) throw new Error("Coding contexts must be configured as 16K or 32K.");
  if (compactionThreshold < 0.6 || compactionThreshold > 0.9) throw new Error("Compaction threshold must stay between 60% and 90%.");
  const allocations = Object.fromEntries(Object.entries(ratios).map(([section, ratio]) => [section, Math.floor(limit * ratio)])) as Record<ContextSection, number>;
  return { limit, compactionThreshold, allocations };
}

export function estimateTokens(value: unknown) {
  const characters = typeof value === "string" ? value.length : JSON.stringify(value).length;
  return Math.ceil(characters / 3.6);
}

export function contextDiagnostics(budget: ContextBudget, sections: Partial<Record<ContextSection, unknown>>) {
  const used = Object.fromEntries(Object.keys(budget.allocations).map((section) => [section, estimateTokens(sections[section as ContextSection] ?? "")])) as Record<ContextSection, number>;
  const totalUsed = Object.values(used).reduce((sum, value) => sum + value, 0);
  return {
    configuredContextLimit: budget.limit,
    estimatedContextUse: totalUsed,
    utilization: totalUsed / budget.limit,
    allocationBySection: budget.allocations,
    estimatedUseBySection: used,
    compactionThreshold: budget.compactionThreshold,
    remainingResponseHeadroom: Math.max(0, budget.allocations.headroom - used.headroom),
    evidenceOmitted: used.evidence > budget.allocations.evidence,
  };
}

export function shouldCompactContext(budget: ContextBudget, sections: Partial<Record<ContextSection, unknown>>, toolResultCount: number, elapsedTurns: number) {
  const diagnostics = contextDiagnostics(budget, sections);
  return diagnostics.utilization >= budget.compactionThreshold || toolResultCount >= 12 || elapsedTurns >= 18 || diagnostics.remainingResponseHeadroom < budget.allocations.headroom * 0.4;
}

type RoleContextInput = {
  role: CodingAgentRole;
  instructions: string;
  approvedTask: string;
  coordination: SharedCoordinationState;
  privateCheckpoint?: AgentPrivateCheckpoint;
  exactEvidence: string[];
  recentToolResults?: string[];
  reviewerFindings?: string[];
};

function bounded(items: string[], maxTokens: number) {
  const selected: string[] = [];
  let used = 0;
  for (const item of items) {
    const cost = estimateTokens(item);
    if (used + cost > maxTokens) break;
    selected.push(item);
    used += cost;
  }
  return selected;
}

export function buildRoleContext(input: RoleContextInput, budget: ContextBudget): { messages: CanonicalMessage[]; diagnostics: ReturnType<typeof contextDiagnostics>; omittedEvidenceCount: number } {
  const exactEvidence = bounded(input.exactEvidence, budget.allocations.evidence);
  const toolResults = bounded(input.recentToolResults ?? [], budget.allocations.recentTools);
  const shared = JSON.stringify(input.coordination);
  const privateWarm = input.privateCheckpoint ? JSON.stringify(input.privateCheckpoint) : "No private checkpoint yet.";
  const roleGuidance: Record<CodingAgentRole, string> = {
    planner: "Decompose approved work and resolve architecture. Do not edit files.",
    implementer: "Implement only assigned subtasks. Re-read exact files before writing and respect active reservations.",
    reviewer: "Review current diffs and checks against acceptance criteria. Read-only by default.",
    repair: "Repair only evidence-backed reviewer findings using current repository evidence.",
    integration: "Integrate completed subtasks, resolve conflicts, and run global checks.",
  };
  const messages: CanonicalMessage[] = [
    { role: "system", content: `${input.instructions}\n\nROLE: ${input.role}\n${roleGuidance[input.role]}\nHistorical summaries never replace current files, Git state, logs, screenshots, or rerun checks.` },
    { role: "user", content: `APPROVED TASK\n${input.approvedTask}` },
    { role: "system", content: `SHARED COORDINATION STATE v${input.coordination.stateVersion}\n${shared.slice(0, Math.floor(budget.allocations.coordination * 3.6))}` },
    { role: "system", content: `PRIVATE WARM CHECKPOINT (${input.coordination.execution.activeAgentId ?? "unassigned"})\n${privateWarm.slice(0, Math.floor(budget.allocations.warm * 3.6))}` },
    { role: "user", content: `EXACT CURRENT EVIDENCE\n${exactEvidence.join("\n\n---\n\n") || "Rehydrate exact evidence before acting."}` },
  ];
  if (input.reviewerFindings?.length) messages.push({ role: "user", content: `REVIEWER FINDINGS\n${bounded(input.reviewerFindings, Math.floor(budget.allocations.task / 2)).join("\n")}` });
  if (toolResults.length) messages.push({ role: "user", content: `RECENT TOOL RESULTS\n${toolResults.join("\n\n")}` });
  const diagnostics = contextDiagnostics(budget, { instructions: input.instructions, task: input.approvedTask, evidence: exactEvidence, coordination: shared, warm: privateWarm, recentTools: toolResults, headroom: "" });
  return { messages, diagnostics, omittedEvidenceCount: input.exactEvidence.length - exactEvidence.length };
}
