import assert from "node:assert/strict";
import test from "node:test";
import {
  isApprovedDiagnosticsPlan,
  normalizeDiagnosticRecommendations,
} from "@/lib/diagnostic-recommendations";

test("normalizes atomic diagnostics recommendations and preserves priorities", () => {
  const result = normalizeDiagnosticRecommendations([
    {
      id: "Broken Navigation",
      priority: "critical",
      title: "Repair broken navigation",
      summary: "The dashboard link is unusable.",
      evidence: "The route returns 404.",
      acceptanceCriteria: ["The link opens successfully."],
    },
    {
      id: "Broken Navigation",
      priority: "medium",
      title: "Add recovery copy",
      summary: "Explain how to recover.",
      evidence: "No recovery text exists.",
      acceptanceCriteria: ["Recovery copy is visible."],
    },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].priority, "critical");
  assert.notEqual(result[0].id, result[1].id);
});

test("drops incomplete recommendations", () => {
  assert.deepEqual(normalizeDiagnosticRecommendations([{ title: "No criteria", summary: "Incomplete" }]), []);
});

test("security bypass requires the exact saved diagnostics plan", () => {
  const run = {
    id: "run-1",
    workflowId: "diagnostics",
    workflowName: "Diagnostics",
    accountName: "Kai Studio",
    salespersonName: "Read-only audit",
    transcript: "audit",
    compiledPrompt: "prompt",
    model: "model",
    output: "report",
    diagnosticsPlan: "Implement only selected item A.",
    createdAt: new Date().toISOString(),
  };
  assert.equal(isApprovedDiagnosticsPlan(run, "Implement only selected item A."), true);
  assert.equal(isApprovedDiagnosticsPlan(run, "Implement everything."), false);
  assert.equal(isApprovedDiagnosticsPlan({ ...run, workflowId: "general" }, run.diagnosticsPlan), false);
});
