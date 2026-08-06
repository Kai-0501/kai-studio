import { createHash } from "node:crypto";
import type { ConversationCheckpoint, ConversationMessage, SavedRun } from "@/types/run";

export function estimateTokens(text: string) { return Math.ceil(text.length / 4); }

function sentences(messages: ConversationMessage[], pattern: RegExp, limit: number) {
  return messages.flatMap((message) => message.content.split(/(?<=[.!?])\s+|\n+/)).map((item) => item.trim()).filter((item) => item.length > 12 && pattern.test(item)).slice(-limit);
}

export function compileConversationCheckpoint(run: SavedRun, messages: ConversationMessage[]): ConversationCheckpoint | undefined {
  const active = messages.filter((message) => !message.deletedAt && message.branchId === run.activeBranchId);
  if (!active.length) return undefined;
  const source = active.slice(-24);
  const last = source.at(-1)!;
  const userMessages = source.filter((item) => item.role === "user");
  const entityCandidates = source.flatMap((message) => message.content.match(/\b[A-Z][\p{L}\d'-]{2,}\b/gu) ?? []);
  const importantEntities = [...new Set(entityCandidates)].slice(0, 18);
  const checkpointBase = {
    version: (run.checkpoint?.version ?? 0) + 1,
    conversationId: run.id,
    branchId: run.activeBranchId!,
    throughMessageId: last.id,
    sourceMessageIds: source.map((item) => item.id),
    currentTopic: userMessages.at(-1)?.content.slice(0, 240) ?? run.title ?? run.accountName,
    currentObjective: userMessages.at(-1)?.content.slice(0, 360) ?? "Continue the current conversation.",
    importantEntities,
    establishedFacts: sentences(source, /\b(is|are|was|were|has|have|must|always|never)\b/i, 14),
    decisions: sentences(source, /\b(decided|agreed|will|should|must|chosen|approved)\b/i, 10),
    unresolvedQuestions: sentences(source, /\?|\b(todo|next|unresolved|need to)\b/i, 10),
    constraints: sentences(source, /\b(must|must not|never|only|keep|avoid|do not)\b/i, 12),
    nextContinuationPoint: userMessages.at(-1)?.content.slice(0, 360) ?? "Continue from the latest turn.",
    updatedAt: new Date().toISOString(),
  };
  return { ...checkpointBase, contentHash: createHash("sha256").update(JSON.stringify(checkpointBase)).digest("hex") };
}

export function shouldCheckpoint(messages: ConversationMessage[], existing?: ConversationCheckpoint) {
  const active = messages.filter((message) => !message.deletedAt);
  const since = existing ? active.findIndex((message) => message.id === existing.throughMessageId) : -1;
  const pending = since >= 0 ? active.slice(since + 1) : active;
  return pending.length >= 10 || pending.reduce((total, message) => total + estimateTokens(message.content), 0) >= 3500;
}

export function checkpointPrompt(checkpoint?: ConversationCheckpoint) {
  if (!checkpoint) return "";
  return JSON.stringify({ topic: checkpoint.currentTopic, objective: checkpoint.currentObjective, entities: checkpoint.importantEntities, facts: checkpoint.establishedFacts, decisions: checkpoint.decisions, unresolved: checkpoint.unresolvedQuestions, constraints: checkpoint.constraints, next: checkpoint.nextContinuationPoint });
}
