import test from "node:test";
import assert from "node:assert/strict";
import { ProgressTracker, countsAsImplementationStep, thresholdNotice } from "../src/lib/coding-loop-policy.ts";
process.env.KAI_STUDIO_DATA_DIR = "/tmp/kai-studio-loop-tests";
const { createCodingLoop, decideCodingLoop, getCodingLoop, waitForExtension } = await import("../src/lib/coding-loop-control.ts");

test("read-only inspection is not an implementation step", () => {
  assert.equal(countsAsImplementationStep("read_file"), false);
  assert.equal(countsAsImplementationStep("search"), false);
  assert.equal(countsAsImplementationStep("write_file"), true);
  assert.deepEqual(thresholdNotice(40, new Set()), [40]);
  assert.deepEqual(thresholdNotice(80, new Set([40])), [80]);
});

test("a coding session can inspect more than 20 times without consuming its mutation budget", () => {
  let implementationSteps = 0;
  let inspectionActions = 0;
  for (let index = 0; index < 30; index += 1) {
    const tool = index % 3 === 0 ? "inspect_tree" : index % 3 === 1 ? "read_file" : "search";
    if (countsAsImplementationStep(tool)) implementationSteps += 1;
    else inspectionActions += 1;
  }
  assert.equal(inspectionActions, 30);
  assert.equal(implementationSteps, 0);
  assert.deepEqual(thresholdNotice(implementationSteps, new Set()), []);
});

test("progress tracker stops identical failures and two-state cycles", () => {
  const tracker = new ProgressTracker();
  for (let index = 0; index < 3; index += 1) tracker.observe({ signature: "run_checks", resultFingerprint: "same", changedRepository: false });
  assert.match(tracker.shouldStop(), /repeated/);
  const cycle = new ProgressTracker();
  for (const signature of ["a", "b", "a", "b", "a", "b"]) cycle.observe({ signature, resultFingerprint: signature, changedRepository: false });
  assert.match(cycle.shouldStop(), /two-state/);
});

test("loop extensions add exactly 50 steps and resolve a paused decision", async () => {
  const id = `test-${Date.now()}-${Math.random()}`;
  await createCodingLoop(id, undefined, 150);
  const waiting = waitForExtension(id);
  await new Promise((resolve) => setImmediate(resolve));
  const state = await decideCodingLoop(id, "extend");
  assert.equal(state?.stepLimit, 200);
  assert.equal(state?.extensionCount, 1);
  assert.equal(await waiting, "extend");
  assert.equal(getCodingLoop(id)?.awaitingExtension, false);
});
