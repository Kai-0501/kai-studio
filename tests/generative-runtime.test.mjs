import assert from "node:assert/strict";
import test from "node:test";
import { GenerativeRuntimeManager } from "@/lib/generative-runtime";

const model = {
  id: "coder-test",
  displayName: "Coder Test",
  provider: "ollama",
  providerModel: "coder-test:latest",
  capabilities: ["chat", "coding"],
  contextWindow: 32_768,
  supportsTools: true,
  supportsStructuredOutput: true,
  supportsVision: false,
  supportsReasoning: false,
  defaultTemperature: 0,
  defaultContextAllocation: 16_384,
  enabled: true,
};

test("sequential logical sessions share one model load and release after the final reference", async () => {
  let loads = 0;
  let unloads = 0;
  let resident = false;
  const manager = new GenerativeRuntimeManager({
    inspect: async () => ({ resident }),
    ensureLoaded: async () => { loads += 1; resident = true; return { resident: true }; },
    unload: async () => { unloads += 1; resident = false; },
    supportsExplicitUnload: () => true,
  });
  const workflow = await manager.acquire({ model, role: "coder.primary", workflow: "coding.sequential", jobId: "job-1", agentSessionId: "weights", minimumWarmSeconds: 0, idleTimeoutSeconds: 0.01 });
  const planner = await manager.acquire({ model, role: "coder.primary", workflow: "coding.planner", jobId: "job-1", agentSessionId: "planner", minimumWarmSeconds: 0, idleTimeoutSeconds: 0.01 });
  const implementer = await manager.acquire({ model, role: "coder.primary", workflow: "coding.implementer", jobId: "job-1", agentSessionId: "implementer", minimumWarmSeconds: 0, idleTimeoutSeconds: 0.01 });
  assert.equal(loads, 1);
  assert.equal(manager.snapshots()[0].leaseCount, 3);
  await planner.release();
  await implementer.release();
  assert.equal(unloads, 0);
  await workflow.release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(unloads, 1);
});

test("reference-count safety prevents memory-pressure eviction of active models", async () => {
  let unloads = 0;
  const manager = new GenerativeRuntimeManager({ inspect: async () => ({ resident: false }), ensureLoaded: async () => ({ resident: true }), unload: async () => { unloads += 1; }, supportsExplicitUnload: () => true });
  const lease = await manager.acquire({ model, role: "diagnostics.primary", workflow: "diagnostics", idleTimeoutSeconds: 30 });
  assert.deepEqual(await manager.evictIdle({ roles: ["diagnostics.primary"] }), []);
  assert.equal(unloads, 0);
  await lease.release();
  const released = await manager.evictIdle({ roles: ["diagnostics.primary"] });
  assert.deepEqual(released, ["Coder Test"]);
  assert.equal(unloads, 1);
});

test("pre-existing external residency is observed but never unloaded", async () => {
  let unloads = 0;
  const manager = new GenerativeRuntimeManager({ inspect: async () => ({ resident: true }), ensureLoaded: async () => ({ resident: true }), unload: async () => { unloads += 1; }, supportsExplicitUnload: () => true });
  const lease = await manager.acquire({ model, role: "coder.primary", workflow: "coding", idleTimeoutSeconds: 0.01, minimumWarmSeconds: 0 });
  assert.equal(lease.snapshot().ownership, "user-managed-external");
  await lease.release();
  await manager.evictIdle();
  assert.equal(unloads, 0);
  assert.equal(manager.snapshots()[0].weightsResident, true);
});

test("role history remains available after lease release for targeted safe eviction", async () => {
  let unloads = 0;
  const manager = new GenerativeRuntimeManager({ inspect: async () => ({ resident: false }), ensureLoaded: async () => ({ resident: true }), unload: async () => { unloads += 1; }, supportsExplicitUnload: () => true });
  const lease = await manager.acquire({ model, role: "orchestrator.cloud", workflow: "orchestration", idleTimeoutSeconds: 30 });
  await lease.release();
  assert.deepEqual(manager.snapshots()[0].rolesSeen, ["orchestrator.cloud"]);
  await manager.evictIdle({ roles: ["diagnostics.primary"] });
  assert.equal(unloads, 0);
  await manager.evictIdle({ roles: ["orchestrator.cloud"] });
  assert.equal(unloads, 1);
});

test("different provider models remain separate residencies", async () => {
  const loads = [];
  const manager = new GenerativeRuntimeManager({
    inspect: async () => ({ resident: false }),
    ensureLoaded: async (candidate) => { loads.push(candidate.providerModel); return { resident: true }; },
    unload: async () => {},
    supportsExplicitUnload: () => true,
  });
  const otherModel = { ...model, id: "reviewer-test", displayName: "Reviewer Test", providerModel: "reviewer-test:latest" };
  const codingLease = await manager.acquire({ model, role: "coder.primary", workflow: "coding", idleTimeoutSeconds: 30 });
  const reviewLease = await manager.acquire({ model: otherModel, role: "review.primary", workflow: "review", idleTimeoutSeconds: 30 });
  assert.deepEqual(loads.sort(), ["coder-test:latest", "reviewer-test:latest"]);
  assert.equal(manager.snapshots().length, 2);
  await codingLease.release();
  await reviewLease.release();
  await manager.shutdown();
});

test("provider-owned image loads never use the shared text warmup", async () => {
  let loads = 0;
  const imageModel = { ...model, id: "image-test", displayName: "Image Test", providerModel: "x/z-image-turbo:latest", capabilities: ["image-generation"] };
  const manager = new GenerativeRuntimeManager({
    inspect: async () => ({ resident: false }),
    ensureLoaded: async () => { loads += 1; return { resident: true }; },
    unload: async () => {},
    supportsExplicitUnload: () => true,
  });
  const lease = await manager.acquire({ model: imageModel, role: "image.generator", workflow: "image", providerOwnsInitialLoad: true, idleTimeoutSeconds: 30 });
  assert.equal(loads, 0);
  assert.equal(lease.snapshot().lifecycle, "active");
  await lease.release();
  await manager.shutdown();
});
