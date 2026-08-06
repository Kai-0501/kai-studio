import test from "node:test";
import assert from "node:assert/strict";
import { orchestrateKaiAgent, validateKaiAgentPlan } from "../src/lib/kai-agent-plan.ts";

test("Kai Agent plans contain an explicit approval boundary", async () => {
  const result = await orchestrateKaiAgent({ task: "Create a bounded local dashboard", target: { kind: "greenfield", value: "dashboard" } });
  const plan = result.plan;
  assert.equal(validateKaiAgentPlan(plan).ready, true);
  assert.ok(plan.securityBoundaries.some((item) => item.toLowerCase().includes("approval")));
});

test("Kai Agent rejects incomplete plans", () => {
  assert.equal(validateKaiAgentPlan({ objective: "", target: { kind: "repository", value: "" } }).ready, false);
});

for (const [name, task] of [
  ["todo desktop app", "Build a private desktop todo app with local persistence and keyboard shortcuts."],
  ["markdown editor", "Build a local Markdown editor with live preview, file open/save, and recent documents."],
  ["local expense tracker", "Build a private expense tracker with categories, a monthly view, and CSV export."],
]) {
  test(`Kai Agent produces an approval-gated greenfield plan for ${name}`, async () => {
    const result = await orchestrateKaiAgent({ task, target: { kind: "greenfield", value: name.replace(/ /g, "-") } });
    assert.equal(validateKaiAgentPlan(result.plan).ready, true);
    assert.equal(result.plan.target.kind, "greenfield");
    assert.ok(result.plan.phases.length >= 2);
    assert.ok(result.plan.verification.length >= 1);
    assert.ok(result.plan.securityBoundaries.some((item) => item.toLowerCase().includes("approval")));
  });
}
