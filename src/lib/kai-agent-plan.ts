import { generateForRole } from "@/lib/models/runtime";
import { parseModelJson } from "@/lib/model-json";

export type KaiAgentPlan = {
  objective: string;
  target: { kind: "repository" | "greenfield"; value: string };
  scope: string[];
  nonGoals: string[];
  constraints: string[];
  phases: string[];
  verification: string[];
  securityBoundaries: string[];
  acceptanceCriteria: string[];
  stopConditions: string[];
};

export function validateKaiAgentPlan(plan: Partial<KaiAgentPlan>) {
  const required = ["objective", "scope", "nonGoals", "constraints", "phases", "verification", "securityBoundaries", "acceptanceCriteria", "stopConditions"] as const;
  const missing: string[] = required.filter((key) => key === "objective" ? typeof plan[key] !== "string" || !plan[key].trim() : !Array.isArray(plan[key]) || plan[key].length === 0 || plan[key].some((item) => typeof item !== "string" || !item.trim()));
  if (!plan.target?.kind || !["repository", "greenfield"].includes(plan.target.kind) || !plan.target.value?.trim()) missing.push("target");
  const unresolved = missing.filter((key) => key === "objective" || key === "target" || key === "acceptanceCriteria" || key === "verification" || key === "securityBoundaries");
  return { ready: missing.length === 0 && unresolved.length === 0, missing, unresolved };
}

export async function orchestrateKaiAgent(request: { target: KaiAgentPlan["target"]; task: string }) {
  const base: KaiAgentPlan = {
    objective: request.task.trim(), target: request.target,
    scope: ["Inspect the approved target and reuse existing architecture", "Implement only the explicitly approved user outcome"],
    nonGoals: ["No publishing, deployment, or unrelated refactor"],
    constraints: ["Preserve existing security boundaries", "Keep changes local and reviewable"],
    phases: ["Inspect", "Implement", "Verify", "Prepare local review summary"],
    verification: ["Run the target repository's declared tests, lint, typecheck, and build checks"],
    securityBoundaries: ["Write only inside the approved repository or greenfield root", "Require explicit human approval before coding"],
    acceptanceCriteria: ["The requested outcome works and existing checks remain green"],
    stopConditions: ["Stop on missing authority, unsafe paths, unresolved ambiguity, or repeated non-progress"],
  };
  const fallbackCompleteness = validateKaiAgentPlan(base);
  try {
    const result = await generateForRole({ role: "orchestrator.cloud", workflow: "kai-studio.kai-agent.orchestration", messages: [{ role: "system", content: "Produce only a JSON implementation plan. Do not write code. The target and user request are authoritative. Include concrete scope, phases, verification, security boundaries, acceptance criteria, and stop conditions. Do not invent external requirements." }, { role: "user", content: JSON.stringify(request) }], temperature: 0.1, maxTokens: 6000, reasoning: "enabled" });
    const parsed = parseModelJson<KaiAgentPlan>(result.text);
    const completeness = validateKaiAgentPlan(parsed);
    if (completeness.ready) return { plan: parsed, completeness, source: "configured-model" as const, modelId: result.modelId };
  } catch {
    // A bounded fallback keeps planning usable when the configured orchestrator is temporarily unavailable.
  }
  return { plan: base, completeness: fallbackCompleteness, source: "safe-local-fallback" as const };
}
