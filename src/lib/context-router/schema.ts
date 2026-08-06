import type { ContextDecision, ContextRoutePlan } from "@/lib/context-router/types";

const decisions = new Set<ContextDecision>(["no_retrieval", "recent_only", "conversation_history", "kailore", "hybrid"]);
const boundedQueries = (value: unknown) => Array.isArray(value) && value.length <= 6 && value.every((item) => typeof item === "string" && item.trim().length <= 240);

export function validateContextPlan(value: unknown): ContextRoutePlan | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as Partial<ContextRoutePlan>;
  if (plan.schema_version !== "1.0" || !plan.decision || !decisions.has(plan.decision)) return null;
  const archive = plan.sources?.conversation_archive;
  const kailore = plan.sources?.kailore;
  if (!archive || !kailore || !plan.sources?.recent_context || !boundedQueries(archive.queries) || !boundedQueries(kailore.queries)) return null;
  if (![archive.top_k, archive.token_budget, kailore.top_k, kailore.token_budget].every((item) => Number.isFinite(item) && item >= 0)) return null;
  if (typeof plan.reason_summary !== "string" || plan.reason_summary.length > 360 || typeof plan.confidence !== "number") return null;
  return {
    ...plan as ContextRoutePlan,
    sources: {
      recent_context: { include: Boolean(plan.sources.recent_context.include) },
      conversation_archive: { include: Boolean(archive.include), queries: archive.queries.map((q) => q.trim()).filter(Boolean), top_k: Math.min(12, Math.floor(archive.top_k)), token_budget: Math.min(16_000, Math.floor(archive.token_budget)) },
      kailore: { include: Boolean(kailore.include), queries: kailore.queries.map((q) => q.trim()).filter(Boolean), top_k: Math.min(12, Math.floor(kailore.top_k)), token_budget: Math.min(12_000, Math.floor(kailore.token_budget)) },
    },
    confidence: Math.max(0, Math.min(1, plan.confidence)),
    continuity_requirements: Array.isArray(plan.continuity_requirements) ? plan.continuity_requirements.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
    intent_class: typeof plan.intent_class === "string" ? plan.intent_class.slice(0, 80) : "unknown",
  };
}

export function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { return JSON.parse(source); } catch { return null; }
}
