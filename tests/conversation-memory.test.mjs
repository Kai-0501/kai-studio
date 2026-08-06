import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileConversationCheckpoint, shouldCheckpoint } from "@/lib/conversation-memory/checkpoint";
import { ConversationMemoryIndex } from "@/lib/conversation-memory/index";
import { compatibleIndex, embeddingIdentity } from "@/lib/retrieval/identity";
import { migrateRunConversation } from "@/lib/run-store";

function legacyRun() {
  return {
    id: "conversation-fixture",
    workflowId: "general-intelligence",
    workflowName: "General Intelligence",
    accountName: "Conversation fixture",
    salespersonName: "Kai",
    transcript: "Please remember the copper lighthouse promise.",
    compiledPrompt: "fixture",
    model: "fixture-model",
    output: "I will preserve the copper lighthouse promise.",
    followUps: [{ role: "user", content: "Now discuss an unrelated orchard.", createdAt: "2026-08-01T00:01:00.000Z" }],
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

test("legacy conversations migrate to stable IDs and one explicit branch", () => {
  const first = migrateRunConversation(legacyRun());
  const second = migrateRunConversation(legacyRun());
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.activeBranchId, second.activeBranchId);
  assert.deepEqual(first.messages.map((item) => item.id), second.messages.map((item) => item.id));
  assert.equal(first.messages[0].parentId, null);
  assert.equal(first.messages[1].parentId, first.messages[0].id);
  assert.ok(first.messages.every((item) => item.branchId === first.activeBranchId));
});

test("conversation archive is branch scoped, bounded, and removable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kai-conversation-index-"));
  const index = new ConversationMemoryIndex(path.join(directory, "conversation.sqlite"));
  const run = migrateRunConversation(legacyRun());
  await index.indexRun(run);
  const matches = await index.search(run.id, run.activeBranchId, "copper lighthouse", 4, 1_000);
  assert.ok(matches.length > 0);
  assert.ok(matches.every((item) => item.conversationId === run.id && item.branchId === run.activeBranchId));
  assert.equal((await index.search(run.id, "branch-that-does-not-exist", "copper", 4, 1_000)).length, 0);
  await index.deleteConversation(run.id);
  assert.equal((await index.status(run.id)).indexedChunks, 0);
  index.close();
});

test("checkpoints are deterministic application-owned structures with source provenance", () => {
  const run = migrateRunConversation(legacyRun());
  const expanded = Array.from({ length: 10 }, (_, index) => ({
    ...run.messages[index % run.messages.length],
    id: `checkpoint-${index}`,
    parentId: index ? `checkpoint-${index - 1}` : null,
    content: `Kai approved constraint ${index}: only preserve established facts and continue the lighthouse chapter.`,
    contentHash: `hash-${index}`,
  }));
  assert.equal(shouldCheckpoint(expanded), true);
  const checkpoint = compileConversationCheckpoint(run, expanded);
  assert.ok(checkpoint);
  assert.equal(checkpoint.conversationId, run.id);
  assert.equal(checkpoint.branchId, run.activeBranchId);
  assert.deepEqual(checkpoint.sourceMessageIds, expanded.map((item) => item.id));
  assert.ok(checkpoint.constraints.length > 0);
});

test("conversation, KaiLore, and coding indexes cannot be treated as compatible", () => {
  const conversation = embeddingIdentity("conversation", "local-hash");
  const lore = embeddingIdentity("kailore", "local-hash");
  const coding = embeddingIdentity("coding", "local-hash");
  assert.equal(compatibleIndex(conversation, lore), false);
  assert.equal(compatibleIndex(conversation, coding), false);
});
