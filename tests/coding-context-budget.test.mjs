import test from "node:test";
import assert from "node:assert/strict";
import { buildRoleContext, createContextBudget, shouldCompactContext } from "../src/lib/coding-context-budget.ts";

function coordination() {
  return { schemaVersion: 1, stateVersion: 1, taskId: "task", objective: "Build safely", approvedScope: ["src"], architectureConstraints: [], acceptanceCriteria: ["Tests pass"], taskGraph: [], sharedDecisions: [], repositoryStateId: "rev-1", checkoutId: "checkout", reservations: [], integrationQueue: [], globalTestState: { passing: 0, failing: 0 }, crossAgentBlockers: [], userApprovals: [], execution: { paused: false, cancelled: false, stepExtensionCount: 0, timeExtensionMinutes: 0 }, updatedAt: new Date().toISOString() };
}

for (const limit of [16_384, 32_768]) {
  test(`role context stays bounded at ${limit / 1024}K and prioritizes current evidence`, () => {
    const budget = createContextBudget(limit);
    const exact = ["CURRENT FILE: export const truth = 1;", ...Array.from({ length: 100 }, (_, index) => `evidence-${index} ${"x".repeat(1000)}`)];
    const built = buildRoleContext({ role: "implementer", instructions: "Stay scoped.", approvedTask: "Fix the current file.", coordination: coordination(), exactEvidence: exact, recentToolResults: ["old tool result"] }, budget);
    assert.equal(built.diagnostics.configuredContextLimit, limit);
    assert.match(JSON.stringify(built.messages), /CURRENT FILE/);
    assert.ok(built.omittedEvidenceCount > 0);
  });
}

test("compaction begins before exhaustion and preserves response headroom", () => {
  const budget = createContextBudget(16_384, 0.78);
  assert.equal(shouldCompactContext(budget, { evidence: "x".repeat(50_000) }, 12, 2), true);
  assert.equal(shouldCompactContext(budget, { evidence: "small" }, 1, 1), false);
});
