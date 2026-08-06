import assert from "node:assert/strict";
import test from "node:test";
import { deterministicContextPlan } from "@/lib/context-router/policy";
import { validateContextPlan } from "@/lib/context-router/schema";

function packet(overrides = {}) {
  return {
    currentMessage: "Explain this self-contained question.",
    recentTurns: [],
    conversationTitle: "Fixture",
    checkpoint: "",
    kaiLoreEnabled: true,
    temporary: false,
    attachmentCount: 0,
    override: "automatic",
    mode: "normal",
    writingContinuityBias: true,
    budgets: { conversation: 5_000, kailore: 3_500, hybrid: 7_500 },
    availability: { conversation: true, kailore: true },
    ...overrides,
  };
}

test("self-contained prompts do not retrieve memory", () => {
  assert.equal(deterministicContextPlan(packet()).decision, "no_retrieval");
});

test("router selects the smallest sufficient continuity domain", () => {
  assert.equal(deterministicContextPlan(packet({ currentMessage: "Continue the chapter we discussed earlier." })).decision, "conversation_history");
  assert.equal(deterministicContextPlan(packet({ currentMessage: "Based on what you know about me, what is my goal?" })).decision, "kailore");
  assert.equal(deterministicContextPlan(packet({ currentMessage: "Continue my plan from earlier based on what you know about me." })).decision, "hybrid");
  assert.equal(deterministicContextPlan(packet({ currentMessage: "Tell me more about that.", recentTurns: [{ role: "assistant", content: "A local answer." }] })).decision, "recent_only");
});

test("writing continuity bias and explicit overrides remain user controlled", () => {
  assert.equal(deterministicContextPlan(packet({ mode: "writing" })).decision, "conversation_history");
  assert.equal(deterministicContextPlan(packet({ mode: "writing", writingContinuityBias: false })).decision, "no_retrieval");
  assert.equal(deterministicContextPlan(packet({ override: "conversation-only" })).decision, "conversation_history");
  assert.equal(deterministicContextPlan(packet({ override: "kailore-only" })).decision, "kailore");
  assert.equal(deterministicContextPlan(packet({ override: "both" })).decision, "hybrid");
  assert.equal(deterministicContextPlan(packet({ override: "no-memory" })).decision, "no_retrieval");
});

test("temporary and clean-room modes fail closed with no retrieval", () => {
  assert.equal(deterministicContextPlan(packet({ temporary: true, override: "both" })).decision, "no_retrieval");
  assert.equal(deterministicContextPlan(packet({ mode: "clean-room", override: "both" })).decision, "no_retrieval");
});

test("router schema clamps budgets and rejects malformed output", () => {
  const valid = validateContextPlan({
    schema_version: "1.0",
    decision: "hybrid",
    sources: {
      recent_context: { include: true },
      conversation_archive: { include: true, queries: ["earlier promise"], top_k: 99, token_budget: 99_999 },
      kailore: { include: true, queries: ["user preference"], top_k: 99, token_budget: 99_999 },
    },
    intent_class: "continuation",
    continuity_requirements: ["preserve commitments"],
    reason_summary: "Both domains are required.",
    confidence: 1.7,
  });
  assert.ok(valid);
  assert.equal(valid.sources.conversation_archive.top_k, 12);
  assert.equal(valid.sources.conversation_archive.token_budget, 16_000);
  assert.equal(valid.sources.kailore.token_budget, 12_000);
  assert.equal(valid.confidence, 1);
  assert.equal(validateContextPlan({ schema_version: "1.0", decision: "hybrid" }), null);
});
