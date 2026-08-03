import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

process.env.KAI_STUDIO_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "kai-federation-"));
const federation = await import("../src/lib/coding-federation.ts");

async function state(taskId) {
  return federation.createCoordinationState({ taskId, objective: "Implement safely", approvedScope: ["src"], architectureConstraints: [], acceptanceCriteria: ["Pass"], taskGraph: [{ id: "work", title: "Work", status: "active", dependencies: [] }], sharedDecisions: [], repositoryStateId: "rev-a", checkoutId: "checkout-a" });
}

test("three logical agents keep private checkpoints isolated", async () => {
  const taskId = `private-${crypto.randomUUID()}`;
  for (const [agentId, role] of [["planner-1", "planner"], ["implementer-1", "implementer"], ["reviewer-1", "reviewer"]]) await federation.savePrivateCheckpoint({ schemaVersion: 1, agentId, role, taskId, assignedSubtasks: [], activeHypothesis: agentId, rejectedHypotheses: [], filesRead: [], filesModified: [], toolsUsed: [], blockers: [], implementationStepCount: 0, executionBudget: { taskClass: "feature", elapsedMinutes: 0, budgetMinutes: 20, automaticExtensionMinutes: 0, userExtensionMinutes: 0, awaitingDecision: false }, approvals: [], repositoryStateId: "rev-a", pendingActions: [], compaction: { count: 0, contextLimit: agentId === "planner-1" ? 16_384 : 32_768 }, updatedAt: new Date().toISOString() });
  assert.equal((await federation.readPrivateCheckpoint(taskId, "planner-1")).activeHypothesis, "planner-1");
  assert.equal((await federation.readPrivateCheckpoint(taskId, "reviewer-1")).activeHypothesis, "reviewer-1");
});

test("shared state rejects stale writers and conflicting reservations", async () => {
  const taskId = `coord-${crypto.randomUUID()}`;
  const created = await state(taskId);
  const first = await federation.reserveTarget(taskId, created.stateVersion, { taskId, subtaskId: "work", agentId: "a", target: "src/app.ts", targetType: "file", mode: "write", purpose: "edit", repositoryStateId: "rev-a" }, 1000);
  await assert.rejects(() => federation.updateCoordinationState(taskId, created.stateVersion, (value) => value), /conflict/);
  await assert.rejects(() => federation.reserveTarget(taskId, first.state.stateVersion, { taskId, subtaskId: "work", agentId: "b", target: "src", targetType: "directory", mode: "write", purpose: "collide", repositoryStateId: "rev-a" }), /Reservation conflict/);
  assert.equal(federation.verifyWriteReservation(first.state, "a", "src/app.ts", "rev-a").allowed, true);
  assert.equal(federation.verifyWriteReservation(first.state, "a", "src/app.ts", "rev-b").requiresRehydration, true);
});

test("leases renew, expire, and structured handoffs validate repository state", async () => {
  const taskId = `lease-${crypto.randomUUID()}`;
  const created = await state(taskId);
  const first = await federation.reserveTarget(taskId, created.stateVersion, { taskId, subtaskId: "work", agentId: "a", target: "src/a.ts", targetType: "file", mode: "write", purpose: "edit", repositoryStateId: "rev-a" }, -1);
  const reclaimed = await federation.reserveTarget(taskId, first.state.stateVersion, { taskId, subtaskId: "work", agentId: "b", target: "src/a.ts", targetType: "file", mode: "write", purpose: "reclaim", repositoryStateId: "rev-a" });
  const renewed = await federation.renewReservation(taskId, reclaimed.state.stateVersion, reclaimed.reservation.id, "b");
  assert.equal(renewed.reservations[0].renewalCount, 1);
  const handoff = { schemaVersion: 1, id: crypto.randomUUID(), sourceAgentId: "b", sourceRole: "implementer", destinationRole: "reviewer", taskId, subtaskId: "work", repositoryStateId: "rev-a", objective: "Review", completedActions: [], filesRead: ["src/a.ts"], filesChanged: ["src/a.ts"], reservationsHeld: [reclaimed.reservation.id], reservationsReleased: [], checks: [], decisions: [], assumptions: [], blockers: [], unresolvedRisks: [], nextRecommendedAction: "Read the diff", evidenceToRehydrate: ["git diff"], acceptanceCriteriaRemaining: [], createdAt: new Date().toISOString() };
  assert.equal(federation.acknowledgeHandoff(handoff, renewed).accepted, true);
  assert.equal(federation.acknowledgeHandoff({ ...handoff, repositoryStateId: "old" }, renewed).staleState, true);
  assert.throws(() => federation.validateHandoff({}), /incomplete/);
});

test("sequential scheduler rotates one execution token across three sessions", () => {
  const scheduler = new federation.SequentialAgentScheduler([{ id: "a", role: "planner" }, { id: "b", role: "implementer" }, { id: "c", role: "reviewer" }]);
  assert.deepEqual([scheduler.next().id, scheduler.next().id, scheduler.next().id, scheduler.next().id], ["a", "b", "c", "a"]);
});
