import assert from "node:assert/strict";
import test from "node:test";
import { EmbeddingRuntimeManager } from "@/lib/embedding-runtime";

const descriptor = (domain = "kailore") => ({
  domain,
  role: domain === "coding" ? "coding.embedding" : "kailore.embedding",
  modelId: "test-embedding",
  modelTag: "test-embedding:latest",
  ownership: "shared-ollama",
  runtime: "ollama",
  policy: { idleTimeoutSeconds: 0.02, minimumWarmSeconds: 0, retainDuringIndexing: true, retainAcrossTransitions: true, evictOnMemoryPressure: true },
});

test("leases reuse one runtime and unload only after the final release", async () => {
  let loads = 0;
  let unloads = 0;
  const manager = new EmbeddingRuntimeManager({ ensureLoaded: async () => { loads += 1; }, isAvailable: async () => true, unload: async () => { unloads += 1; } });
  const first = await manager.acquire(descriptor());
  const second = await manager.acquire(descriptor());
  assert.equal(loads, 1);
  await first.release();
  assert.equal(manager.snapshots()[0].leaseCount, 1);
  await second.release();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(unloads, 1);
  assert.equal(manager.snapshots()[0].lifecycle, "cold");
});

test("memory-pressure eviction never evicts an active lease", async () => {
  let unloads = 0;
  const manager = new EmbeddingRuntimeManager({ ensureLoaded: async () => {}, isAvailable: async () => true, unload: async () => { unloads += 1; } });
  const active = await manager.acquire(descriptor("coding"));
  await manager.evictIdle();
  assert.equal(unloads, 0);
  await active.release();
  await manager.evictIdle();
  assert.equal(unloads, 1);
});

test("unavailable runtimes are reported without taking down retrieval callers", async () => {
  const manager = new EmbeddingRuntimeManager({ ensureLoaded: async () => {}, isAvailable: async () => false });
  const lease = await manager.acquire(descriptor());
  assert.equal(lease.snapshot().lifecycle, "active");
  assert.equal(lease.snapshot().lastError, "Assigned embedding runtime is not available.");
  await lease.release();
});
