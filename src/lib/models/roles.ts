import type { ModelAssignments } from "@/types/settings";

export type ModelRoleDescription = {
  key: keyof ModelAssignments | "future";
  label: string;
  description: string;
  capabilities: string[];
};

/**
 * Human-facing role metadata has one home so Settings, validation, and future
 * surfaces never need to repeat (or subtly disagree on) model-role prose.
 */
export const modelRoleDescriptions: readonly ModelRoleDescription[] = [
  { key: "chat", label: "Chat", description: "Powers everyday Kai Studio conversations.", capabilities: ["chat"] },
  { key: "meeting", label: "Meeting Intelligence", description: "Turns meeting material into structured, grounded follow-up work.", capabilities: ["chat", "structured output"] },
  { key: "editorial", label: "Editorial Intelligence", description: "Edits writing while preserving meaning, evidence, and voice.", capabilities: ["editorial"] },
  { key: "account", label: "Account Intelligence", description: "Analyses supplied account research for sales preparation.", capabilities: ["chat", "reasoning"] },
  { key: "general", label: "General Intelligence", description: "Builds structured learning sessions and general-purpose assistance.", capabilities: ["chat", "reasoning"] },
  { key: "coding", label: "Coding", description: "Implements approved repository and greenfield work through Kai Studio’s bounded toolbelt.", capabilities: ["coding", "tools", "structured output"] },
  { key: "security", label: "Security", description: "Reviews untrusted repository material before GitHub-originated coding work starts.", capabilities: ["security review", "structured output"] },
  { key: "vision", label: "Vision", description: "Extracts bounded visual evidence before another model reasons over it.", capabilities: ["vision"] },
  { key: "diagnostics", label: "Diagnostics", description: "Inspects Kai Studio as a user and reports bugs, friction, and reliability concerns.", capabilities: ["reasoning"] },
  { key: "diagnosticsParser", label: "Diagnostics parser", description: "Converts a completed diagnostics report into selectable recommendations; it does not diagnose independently.", capabilities: ["structured output"] },
  { key: "progressAssessor", label: "Progress assessor", description: "Assesses ambiguous coding progress using observable evidence and preserves uncertainty.", capabilities: ["structured output"] },
  { key: "orchestration", label: "Orchestration", description: "Creates bounded implementation plans and handoffs for approved work.", capabilities: ["reasoning", "structured output"] },
  { key: "review", label: "Review", description: "Performs a final local review of completed work and verification evidence.", capabilities: ["repository review", "structured output"] },
  { key: "kaiLoreEmbedding", label: "KaiLore Embedding", description: "Indexes KaiLore personal memory for private conversational retrieval; it is not used by coding agents.", capabilities: ["embedding"] },
  { key: "codingEmbedding", label: "Coding Embedding", description: "Indexes approved repository evidence for hybrid coding retrieval; it never reads KaiLore.", capabilities: ["embedding"] },
  { key: "future", label: "Future roles", description: "New Kai Studio capabilities inherit this registry pattern instead of embedding a model name in a component.", capabilities: [] },
] as const;

export const modelRoleByKey = new Map(modelRoleDescriptions.map((role) => [role.key, role]));

export const defaultModelAssignments: ModelAssignments = {
  chat: "gemma4:26b-mlx",
  meeting: "gemma4:12b-mlx",
  editorial: "gemma4:12b-mlx",
  account: "gemma4:26b-mlx",
  general: "gemma4:26b-mlx",
  coding: "qwen3.6:27b-mtp-q4_K_M",
  security: "gemma4:31b-mlx",
  vision: "glm-ocr",
  diagnostics: "gemma4:31b-mlx",
  diagnosticsParser: "gemma4:12b-mlx",
  progressAssessor: "gemma4:12b-mlx",
  orchestration: "gemini-2.5-pro",
  review: "gemma4:31b-mlx",
  kaiLoreEmbedding: "local-hash",
  codingEmbedding: "local-hash",
};

export function modelRoleDescription(key: keyof ModelAssignments) {
  return modelRoleByKey.get(key)!;
}
