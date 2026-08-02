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
  const missing: string[] = required.filter((key) => typeof plan[key] !== "string" && !Array.isArray(plan[key]));
  if (!plan.target?.kind || !plan.target.value) missing.push("target");
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
  const completeness = validateKaiAgentPlan(base);
  if (completeness.ready) return { plan: base, completeness };
  const result = await generateForRole({ role: "orchestrator.cloud", workflow: "kai-studio.kai-agent.orchestration", messages: [{ role: "system", content: "Produce only a JSON implementation plan. Do not write code. Do not invent external requirements." }, { role: "user", content: JSON.stringify(request) }], temperature: 0.1, maxTokens: 6000, reasoning: "enabled" });
  const parsed = parseModelJson< KaiAgentPlan >(result.text);
  return { plan: parsed, completeness: validateKaiAgentPlan(parsed) };
}
