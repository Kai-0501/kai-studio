import { kaiLoreMemoryRetriever } from "@/lib/memory/runtime";
import { readSettings } from "@/lib/settings-store";
import { embeddingRuntimeManager } from "@/lib/embedding-runtime";
import { conversationMemoryStatus } from "@/lib/conversation-memory/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [settings, kaiLore, conversation] = await Promise.all([readSettings(), kaiLoreMemoryRetriever(), conversationMemoryStatus()]);
  const generation = await kaiLore.generationStatus();
  return Response.json({
    runtimes: embeddingRuntimeManager.snapshots(),
    kaiLore: {
      model: settings.modelAssignments.kaiLoreEmbedding,
      status: generation ? "active" : "not-indexed",
      generation,
      message: generation ? "Existing index remains active while a new generation is prepared." : "No KaiLore index is active yet.",
    },
    coding: {
      model: settings.modelAssignments.codingEmbedding,
      status: "per-repository",
      message: "Coding indexes are created inside each approved build workspace and remain repository-scoped.",
      hybridEnabled: true,
      reranker: "not configured",
    },
    conversation: {
      model: settings.modelAssignments.conversationEmbedding,
      status: conversation.indexedChunks ? "active" : "not-indexed",
      generation: conversation.generation,
      indexedChunks: conversation.indexedChunks,
      message: conversation.indexedChunks ? "Conversation archives are indexed independently from KaiLore." : "Conversation history will be indexed after a saved chat needs older context.",
    },
  });
}
