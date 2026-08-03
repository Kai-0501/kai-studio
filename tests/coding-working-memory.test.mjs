import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

process.env.KAI_STUDIO_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "kai-working-memory-"));
const { CodingWorkingMemory } = await import("../src/lib/coding-working-memory.ts");

test("private cold memory is bounded, ordered, filterable, and marks stale evidence", async () => {
  const taskId = `memory-${crypto.randomUUID()}`;
  const memory = await CodingWorkingMemory.create([{ role: "user", content: "Implement the approved change." }], taskId, { agentId: "implementer-1", contextLimit: 16_384, repositoryStateId: "rev-a" });
  await memory.record({ status: "Read exact source", tool: "read_file", path: "src/a.ts", startLine: 1, endLine: 20 }, "export const a = 1;");
  await memory.note("Evidence-backed hypothesis");
  memory.setRepositoryStateId("rev-b");
  const events = await memory.retrieveColdEvents("source hypothesis", 40, { taskId, agentId: "implementer-1" });
  assert.ok(events.length >= 1);
  assert.deepEqual(events.map((event) => event.at), [...events].map((event) => event.at).sort());
  assert.ok(events.some((event) => event.staleHistoricalState));
  assert.ok(events.every((event) => event.taskId === taskId && event.agentId === "implementer-1"));
});

test("one task ledger survives agent recreation while retrieval stays private by default", async () => {
  const taskId = `federated-${crypto.randomUUID()}`;
  const implementer = await CodingWorkingMemory.create([{ role: "user", content: "Implement." }], taskId, { agentId: "implementer-1", subtaskId: "implement", repositoryStateId: "rev-a" });
  await implementer.note("Implementer-only evidence");
  const reviewer = await CodingWorkingMemory.create([{ role: "user", content: "Review." }], taskId, { agentId: "reviewer-1", subtaskId: "review", repositoryStateId: "rev-a" });
  await reviewer.note("Reviewer-only evidence");
  assert.equal((await implementer.retrieveColdEvents("evidence", 20)).length, 1);
  assert.equal((await reviewer.retrieveColdEvents("evidence", 20)).length, 1);
  assert.equal((await implementer.retrieveColdEvents("Reviewer", 20)).length, 0);
  assert.equal((await reviewer.retrieveColdEvents("Implementer", 20)).length, 0);
});

test("proactive compaction preserves warm history but requires exact file rehydration", async () => {
  const taskId = `compact-${crypto.randomUUID()}`;
  const memory = await CodingWorkingMemory.create([{ role: "system", content: "Stay scoped." }, { role: "user", content: "Update src/a.ts." }], taskId, { contextLimit: 16_384, repositoryStateId: "rev-a" });
  await memory.record({ status: "Read exact file", tool: "read_file", path: "src/a.ts", startLine: 1, endLine: 20 }, "export const a = 1;");
  assert.equal(memory.hasReadCurrentFile("src/a.ts"), true);
  for (let index = 0; index < 12; index += 1) await memory.record({ status: `Inspect ${index}`, tool: "inspect_tree", path: "." }, `tree-${index}`);
  assert.equal(memory.hasReadCurrentFile("src/a.ts"), false);
  assert.ok(memory.warmCheckpoint().context.compactionCount >= 1);
  const checkpoints = await memory.retrieveColdEvents("", 40, { eventType: "checkpoint" });
  assert.ok(checkpoints.length >= 1);
});
