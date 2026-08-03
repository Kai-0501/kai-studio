import test from "node:test";
import assert from "node:assert/strict";
import { applyBudgetDecision, classifyTask, createExecutionBudget, evaluateExecutionBudget, extendExecutionBudget, recordProgress, stopExecutionForReview } from "../src/lib/execution-budget.ts";
import { safeAssessmentFallback, validateProgressAssessment } from "../src/lib/progress-assessor.ts";

const safe = { rssBytes: 100, rssLimitBytes: 1000 };

test("task classes and user override determine bounded initial budgets", () => {
  assert.equal(classifyTask({ task: "Fix login bug" }), "focused_bug_fix");
  assert.equal(classifyTask({ greenfield: true }), "greenfield_application");
  assert.equal(createExecutionBudget("small_feature", 999).initialBudgetMinutes, 180);
});

test("soft warning, notification, bounded auto continuation, and pause are deterministic", () => {
  const start = Date.now();
  let state = createExecutionBudget("new_subsystem", undefined, start);
  assert.equal(evaluateExecutionBudget(state, safe, start + 15 * 60_000).action, "soft_warning");
  state = applyBudgetDecision(state, { action: "soft_warning", reason: "checkpoint" }, start + 15 * 60_000);
  assert.equal(evaluateExecutionBudget(state, safe, start + 30 * 60_000).action, "notify");
  state = applyBudgetDecision(state, { action: "notify", reason: "notify" }, start + 30 * 60_000);
  state = recordProgress(state, { kind: "repository_change", fingerprint: "diff-1", evidence: "Implemented subsystem" }, start + 44 * 60_000);
  const decision = evaluateExecutionBudget(state, safe, start + 45 * 60_000);
  assert.deepEqual(decision, { action: "auto_extend", reason: "Recent deterministic progress supports a bounded continuation.", extensionMinutes: 5 });
  for (let index = 0; index < 4; index += 1) state = applyBudgetDecision(state, { action: "auto_extend", reason: "progress", extensionMinutes: 5 }, start + (45 + index * 5) * 60_000);
  assert.equal(evaluateExecutionBudget(state, safe, start + 65 * 60_000).action, "pause");
});

test("15 and 30 minute user extensions preserve accumulated state", () => {
  let state = createExecutionBudget("refactor", undefined, 0);
  state = applyBudgetDecision(state, { action: "pause", reason: "boundary" }, 30 * 60_000);
  state = extendExecutionBudget(state, 15, 31 * 60_000);
  state = extendExecutionBudget(state, 30, 32 * 60_000);
  assert.equal(state.userExtensionMinutes, 45);
  assert.equal(state.budgetMinutes, 75);
  assert.equal(state.awaitingDecision, false);
  assert.equal(stopExecutionForReview(state).stoppedForReview, true);
});

test("unsafe resources terminate and malformed or low-confidence assessment fails safe", () => {
  const state = createExecutionBudget("small_feature", undefined, 0);
  assert.equal(evaluateExecutionBudget(state, { rssBytes: 2000, rssLimitBytes: 1000 }, 1).action, "terminate");
  assert.throws(() => validateProgressAssessment({ decision: "continue" }), /malformed/);
  assert.equal(safeAssessmentFallback().decision, "pause_for_user");
  assert.equal(validateProgressAssessment({ decision: "pause_for_user", extension_minutes: 0, meaningful_progress: false, confidence: 0.2, reason: "Ambiguous", required_user_attention: true }).required_user_attention, true);
});
