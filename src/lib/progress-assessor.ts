import { parseModelJson } from "@/lib/model-json";
import { generateForRole } from "@/lib/models/runtime";

export type ProgressAssessmentInput = {
  taskType: string;
  elapsedMinutes: number;
  currentBudgetMinutes: number;
  implementationStepCount: number;
  completedSubtasks: string[];
  remainingSubtasks: string[];
  filesRead: string[];
  filesModified: string[];
  repositoryRevisionChanges: number;
  testsBefore: { passing: number; failing: number };
  testsNow: { passing: number; failing: number };
  buildMilestones: string[];
  currentBlocker: string;
  currentHypothesis: string;
  hypothesisIsNew: boolean;
  minutesSinceDeterministicProgress: number;
  repeatedCommandCount: number;
  identicalDiffCount: number;
  stateCycleCount: number;
  resourceStatus: string;
  pendingHandoffs: number;
  reservationConflicts: number;
  recentProgressEvents: Array<{ kind: string; evidence: string }>;
};

export type ProgressAssessment = {
  decision: "continue" | "pause_for_user" | "terminate";
  extension_minutes: number;
  meaningful_progress: boolean;
  confidence: number;
  reason: string;
  required_user_attention: boolean;
};

export function validateProgressAssessment(value: unknown): ProgressAssessment {
  const item = value as ProgressAssessment;
  if (!item || !["continue", "pause_for_user", "terminate"].includes(item.decision) || !Number.isFinite(item.extension_minutes) || ![0, 5, 15, 30].includes(item.extension_minutes) || typeof item.meaningful_progress !== "boolean" || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1 || typeof item.reason !== "string" || !item.reason.trim() || typeof item.required_user_attention !== "boolean") throw new Error("The progress assessor returned malformed output.");
  return item;
}

export async function assessAmbiguousProgress(input: ProgressAssessmentInput) {
  const result = await generateForRole({
    role: "progress.assessor",
    workflow: "coding.progress-assessment",
    temperature: 0,
    maxTokens: 1024,
    reasoning: "disabled",
    messages: [
      { role: "system", content: "You are Kai Studio's narrow coding-progress assessor. Application facts are authoritative. Do not invent files, tests, diffs, or progress. Decide only whether this compact snapshot supports continue, pause_for_user, or terminate. Automatic continuation may recommend exactly 5 minutes. Ambiguity, low confidence, or malformed evidence must pause for the user. Return only one JSON object with decision, extension_minutes, meaningful_progress, confidence, reason, and required_user_attention." },
      { role: "user", content: JSON.stringify(input) },
    ],
  });
  return validateProgressAssessment(parseModelJson(result.text));
}

export function safeAssessmentFallback(error?: unknown): ProgressAssessment {
  return { decision: "pause_for_user", extension_minutes: 0, meaningful_progress: false, confidence: 0, reason: error instanceof Error ? `Assessment unavailable: ${error.message}` : "Progress remained ambiguous, so the application paused safely.", required_user_attention: true };
}
