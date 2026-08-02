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
