import type { AgentAction } from "@/lib/coding-agent";

export const SOFT_WARNING_STEP = 40;
export const USER_NOTIFICATION_STEP = 80;
export const PAUSE_STEP = 150;
export const EXTENSION_STEPS = 50;

const readOnlyTools = new Set<AgentAction["tool"]>([
  "inspect_tree",
  "read_file",
  "search",
  "inspect_screenshot",
]);

export function isReadOnlyAction(tool: AgentAction["tool"]) {
  return readOnlyTools.has(tool);
}

export function countsAsImplementationStep(tool: AgentAction["tool"]) {
  return !isReadOnlyAction(tool) && tool !== "finish";
}

export type ProgressSample = {
  signature: string;
  resultFingerprint: string;
  changedRepository: boolean;
  meaningfulHypothesis?: boolean;
};

export class ProgressTracker {
  private readonly samples: ProgressSample[] = [];
  private unchangedFailureCount = 0;

  observe(sample: ProgressSample) {
    const previous = this.samples.at(-1);
    if (previous && previous.signature === sample.signature && previous.resultFingerprint === sample.resultFingerprint && !sample.changedRepository && !sample.meaningfulHypothesis) {
      this.unchangedFailureCount += 1;
    } else {
      this.unchangedFailureCount = 0;
    }
    this.samples.push(sample);
    if (this.samples.length > 12) this.samples.shift();
  }

  shouldStop() {
    if (this.unchangedFailureCount >= 2) return "The agent repeated the same action without a meaningful state or hypothesis change.";
    const recent = this.samples.slice(-6).map((sample) => sample.signature);
    if (recent.length === 6 && recent[0] === recent[2] && recent[2] === recent[4] && recent[1] === recent[3] && recent[3] === recent[5] && recent[0] !== recent[1]) {
      return "The agent entered a two-state action cycle without measurable progress.";
    }
    const failures = this.samples.slice(-4).filter((sample) => sample.signature.startsWith("run_checks:") && !sample.changedRepository);
    if (failures.length === 4 && new Set(failures.map((sample) => sample.resultFingerprint)).size === 1) {
      return "The same failing checks repeated without a new hypothesis or repository change.";
    }
    return null;
  }
}

export function thresholdNotice(stepCount: number, warned: Set<number>) {
  const notices: number[] = [];
  for (const threshold of [SOFT_WARNING_STEP, USER_NOTIFICATION_STEP]) {
    if (stepCount >= threshold && !warned.has(threshold)) notices.push(threshold);
  }
  return notices;
}
