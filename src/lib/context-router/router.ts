import { generateForRole } from "@/lib/models/runtime";
import { extractJson, validateContextPlan } from "@/lib/context-router/schema";
import { deterministicContextPlan } from "@/lib/context-router/policy";
import type { ContextRoutePlan, ContextRoutingPacket } from "@/lib/context-router/types";

const system = `You are Kai Studio's Context Router. Select the smallest sufficient context set. Never answer the user. Never reveal hidden reasoning. Return only valid JSON matching schema_version 1.0 with decision, sources.recent_context, sources.conversation_archive, sources.kailore, intent_class, continuity_requirements, reason_summary and confidence. Allowed decisions: no_retrieval, recent_only, conversation_history, kailore, hybrid. Hybrid is only for genuine dual-domain need. Temporary and clean-room chats never retrieve durable memory.`;

export async function routeContext(packet: ContextRoutingPacket, signal?: AbortSignal): Promise<ContextRoutePlan> {
  const deterministic = deterministicContextPlan(packet);
  if (packet.override !== "automatic" || packet.temporary || packet.mode === "temporary" || packet.mode === "clean-room") return deterministic;
  try {
    const result = await generateForRole({ role: "context.router", workflow: "kai-studio.context-routing", signal, temperature: 0, maxTokens: 900, schema: { type: "object" }, messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(packet) },
    ] });
    const validated = validateContextPlan(extractJson(result.text));
    if (!validated) return deterministic;
    if (!packet.kaiLoreEnabled || !packet.availability.kailore) {
      validated.sources.kailore = { include: false, queries: [], top_k: 0, token_budget: 0 };
      if (validated.decision === "kailore") validated.decision = "recent_only";
      if (validated.decision === "hybrid") validated.decision = "conversation_history";
    }
    if (!packet.availability.conversation) {
      validated.sources.conversation_archive = { include: false, queries: [], top_k: 0, token_budget: 0 };
      if (validated.decision === "conversation_history") validated.decision = "recent_only";
      if (validated.decision === "hybrid") validated.decision = validated.sources.kailore.include ? "kailore" : "recent_only";
    }
    return validated;
  } catch {
    return deterministic;
  }
}
