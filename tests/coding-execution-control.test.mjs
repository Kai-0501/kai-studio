import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { applyBudgetDecision } from "../src/lib/execution-budget.ts";

process.env.KAI_STUDIO_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "kai-execution-control-"));
const control = await import("../src/lib/coding-execution-control.ts");

test("durable execution controls preserve state across multiple exact extensions", async () => {
  const buildId = `budget-${crypto.randomUUID()}`;
  let state = await control.createCodingExecutionBudget(buildId, "job-1", "refactor");
  state = await control.replaceCodingExecutionBudget(buildId, applyBudgetDecision(state, { action: "pause", reason: "boundary" }));
  assert.equal(state.awaitingDecision, true);
  await control.decideCodingExecutionBudget(buildId, "extend15");
  state = control.getCodingExecutionBudget(buildId);
  assert.equal(state.userExtensionMinutes, 15);
  state = await control.replaceCodingExecutionBudget(buildId, applyBudgetDecision(state, { action: "pause", reason: "next boundary" }));
  await control.decideCodingExecutionBudget(buildId, "extend30");
  assert.equal(control.getCodingExecutionBudget(buildId).userExtensionMinutes, 45);
  const persisted = JSON.parse(await readFile(path.join(process.env.KAI_STUDIO_DATA_DIR, "coding-execution-state", `${buildId}.json`), "utf8"));
  assert.equal(persisted.userExtensionMinutes, 45);
  assert.equal(persisted.awaitingDecision, false);
});

