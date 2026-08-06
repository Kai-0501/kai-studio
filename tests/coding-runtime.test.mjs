import assert from "node:assert/strict";
import test from "node:test";
import { activateCodingAgentSession, applyMemoryPressurePolicy, createCodingAgentSessions, memoryPressureLevel } from "@/lib/coding-runtime";

test("memory pressure classification is deterministic", () => {
  assert.equal(memoryPressureLevel(500, 1_000), "normal");
  assert.equal(memoryPressureLevel(100, 1_000), "elevated");
  assert.equal(memoryPressureLevel(50, 1_000), "unsafe");
});

test("conservative fallback reduces 32K to 16K before changing execution mode", () => {
  const result = applyMemoryPressurePolicy({ freeBytes: 100, totalBytes: 1_000, contextLimit: 32_768, mode: "multi-agent-sequential", fallback: "offer-16k" });
  assert.equal(result.contextLimit, 16_384);
  assert.equal(result.mode, "multi-agent-sequential");
  assert.match(result.fallbackMode, /32K to 16K/);
});

test("16K pressure fallback can switch to one reconstructable agent", () => {
  const result = applyMemoryPressurePolicy({ freeBytes: 50, totalBytes: 1_000, contextLimit: 16_384, mode: "multi-agent-sequential", fallback: "offer-16k" });
  assert.equal(result.mode, "single-agent");
  assert.equal(result.requiresUserDecision, false);
});

test("pause policy fails closed before model loading", () => {
  const result = applyMemoryPressurePolicy({ freeBytes: 50, totalBytes: 1_000, contextLimit: 16_384, mode: "multi-agent-sequential", fallback: "pause" });
  assert.equal(result.requiresUserDecision, true);
  assert.match(result.fallbackMode, /Paused before loading/);
});

test("planner, implementer, and reviewer rotate sequentially with private reconstructable caches", () => {
  const sessions = createCodingAgentSessions({
    jobId: "job-sequential",
    roles: ["planner", "implementer", "reviewer"],
    contextLimit: 16_384,
    inactiveAgentCachePolicy: "checkpoint-reconstruct",
    provider: "ollama",
  });
  activateCodingAgentSession({ sessions, role: "planner", provider: "ollama", inactiveAgentCachePolicy: "checkpoint-reconstruct", estimatedContextUse: 8_000, now: "2026-08-04T00:00:00.000Z" });
  activateCodingAgentSession({ sessions, role: "implementer", provider: "ollama", inactiveAgentCachePolicy: "checkpoint-reconstruct", estimatedContextUse: 10_000, now: "2026-08-04T00:01:00.000Z" });
  assert.deepEqual(sessions.map(({ role, status, kvCache, checkpointAvailable }) => ({ role, status, kvCache, checkpointAvailable })), [
    { role: "planner", status: "checkpointed", kvCache: "compacted", checkpointAvailable: true },
    { role: "implementer", status: "active", kvCache: "active", checkpointAvailable: false },
    { role: "reviewer", status: "pending", kvCache: "released", checkpointAvailable: false },
  ]);
  activateCodingAgentSession({ sessions, role: "reviewer", provider: "ollama", inactiveAgentCachePolicy: "checkpoint-reconstruct", estimatedContextUse: 6_000, now: "2026-08-04T00:02:00.000Z" });
  assert.equal(sessions.filter((session) => session.status === "active").length, 1);
  assert.equal(sessions.find((session) => session.role === "implementer").kvCache, "compacted");
  assert.equal(sessions.find((session) => session.role === "reviewer").kvCache, "active");
});
