import { ConversationMemoryIndex, type ConversationEvidence } from "@/lib/conversation-memory/index";
import { findRun, updateRunConversation } from "@/lib/run-store";
import { readSettings } from "@/lib/settings-store";
import { compileConversationCheckpoint, shouldCheckpoint } from "@/lib/conversation-memory/checkpoint";
import { withEmbeddingLease, type EmbeddingRuntimeDescriptor } from "@/lib/embedding-runtime";

const indexes = new Map<string, ConversationMemoryIndex>();
function indexFor(modelId: string) { const existing = indexes.get(modelId); if (existing) return existing; const index = new ConversationMemoryIndex(undefined, modelId); indexes.set(modelId, index); return index; }

export async function ensureConversationIndexed(conversationId: string) {
  const run = await findRun(conversationId); if (!run?.messages?.length || !run.activeBranchId) return null;
  const settings = await readSettings();
  const modelId = settings.modelAssignments.conversationEmbedding;
  if (settings.contextRouting.automaticCheckpointing && shouldCheckpoint(run.messages, run.checkpoint)) { const checkpoint = compileConversationCheckpoint(run, run.messages); if (checkpoint) { run.checkpoint = checkpoint; await updateRunConversation(run.id, { checkpoint }); } }
  const descriptor: EmbeddingRuntimeDescriptor = { domain: "conversation", role: "conversation.embedding", modelId, modelTag: modelId, ownership: modelId.includes(":") ? "shared-ollama" : "unsupported", runtime: modelId.includes(":") ? "ollama" : "external", policy: settings.embeddingRuntime.conversation };
  return withEmbeddingLease(descriptor, async () => ({ run, result: await indexFor(modelId).indexRun(run) }));
}

export async function retrieveConversationEvidence(conversationId: string, queries: string[], topK: number, tokenBudget: number): Promise<{ evidence: ConversationEvidence[]; staleRejected: number; lexicalFallback: boolean }> {
  const indexed = await ensureConversationIndexed(conversationId); if (!indexed?.run.activeBranchId) return { evidence: [], staleRejected: 0, lexicalFallback: true };
  const settings = await readSettings(); const all = (await Promise.all(queries.map((query) => indexFor(settings.modelAssignments.conversationEmbedding).search(conversationId, indexed.run.activeBranchId!, query, topK, tokenBudget)))).flat();
  const byId = new Map(indexed.run.messages?.map((message) => [message.id, message])); let staleRejected = 0;
  const coldBoundary = Math.max(0, (indexed.run.messages?.filter((message) => !message.deletedAt && message.branchId === indexed.run.activeBranchId).length ?? 0) - 6);
  const exact = all.filter((chunk) => { const source = chunk.messageIds.map((id) => byId.get(id)).filter(Boolean); const valid = chunk.sequenceEnd < coldBoundary && source.length === chunk.messageIds.length && source.every((message) => !message!.deletedAt && message!.branchId === indexed.run.activeBranchId && chunk.text.length <= message!.content.length && message!.content.includes(chunk.text)); if (!valid) staleRejected += 1; return valid; });
  const unique = [...new Map(exact.map((item) => [item.chunkId, item])).values()].sort((a, b) => a.sequenceStart - b.sequenceStart).slice(0, topK);
  return { evidence: unique, staleRejected, lexicalFallback: settings.modelAssignments.conversationEmbedding === "local-hash" };
}

export async function removeConversationMemory(conversationId: string) { for (const index of indexes.values()) await index.deleteConversation(conversationId); }

export async function conversationMemoryStatus(conversationId?: string) {
  const settings = await readSettings();
  return indexFor(settings.modelAssignments.conversationEmbedding).status(conversationId);
}
