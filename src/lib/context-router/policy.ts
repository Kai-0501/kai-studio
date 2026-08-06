import type { ContextRoutePlan, ContextRoutingPacket } from "@/lib/context-router/types";

function plan(packet: ContextRoutingPacket, decision: ContextRoutePlan["decision"], reason: string): ContextRoutePlan {
  const conversation = decision === "conversation_history" || decision === "hybrid";
  const kailore = decision === "kailore" || decision === "hybrid";
  return {
    schema_version: "1.0", decision,
    sources: {
      recent_context: { include: decision !== "no_retrieval" },
      conversation_archive: { include: conversation, queries: conversation ? [packet.currentMessage.slice(0, 220)] : [], top_k: conversation ? 6 : 0, token_budget: conversation ? packet.budgets.conversation : 0 },
      kailore: { include: kailore, queries: kailore ? [packet.currentMessage.slice(0, 220)] : [], top_k: kailore ? 5 : 0, token_budget: kailore ? packet.budgets.kailore : 0 },
    },
    intent_class: decision === "conversation_history" ? "conversation_continuation" : decision === "kailore" ? "personal_continuity" : decision,
    continuity_requirements: [], reason_summary: reason, confidence: 0.68, fallback_used: true,
  };
}

export function deterministicContextPlan(packet: ContextRoutingPacket): ContextRoutePlan {
  if (packet.temporary || packet.mode === "temporary" || packet.mode === "clean-room" || packet.override === "no-memory") return plan(packet, "no_retrieval", "Memory retrieval is disabled for this message.");
  if (packet.override === "conversation-only") return plan(packet, packet.availability.conversation ? "conversation_history" : "recent_only", "Using only this conversation as requested.");
  if (packet.override === "kailore-only") return plan(packet, packet.kaiLoreEnabled && packet.availability.kailore ? "kailore" : "recent_only", "Using only durable personal memory as requested.");
  if (packet.override === "both") return plan(packet, packet.kaiLoreEnabled ? "hybrid" : "conversation_history", "Using both approved context domains as requested.");
  const text = packet.currentMessage.toLocaleLowerCase();
  const earlier = /\b(earlier|before|previous|we discussed|you said|i said|that character|continue|chapter|scene|plot|promise|time jump|established)\b/.test(text);
  const personal = /\b(my preference|my goal|my plan|about me|kailore|remember me|what do i usually|based on what you know about me)\b/.test(text);
  const writingContinuity = packet.mode === "writing" && packet.writingContinuityBias;
  if ((writingContinuity || earlier) && personal && packet.kaiLoreEnabled) return plan(packet, "hybrid", "Both local conversation continuity and durable personal context appear relevant.");
  if (writingContinuity || earlier) return plan(packet, packet.availability.conversation ? "conversation_history" : "recent_only", "The request refers to earlier material in this conversation.");
  if (personal && packet.kaiLoreEnabled) return plan(packet, "kailore", "The request depends on durable personal context.");
  if (/\b(this|that|it|they|them|tell me more|what about)\b/.test(text) && packet.recentTurns.length) return plan(packet, "recent_only", "The immediate exchange is sufficient.");
  return plan(packet, "no_retrieval", "The request is self-contained and needs no memory retrieval.");
}
