export type ContextDecision = "no_retrieval" | "recent_only" | "conversation_history" | "kailore" | "hybrid";
export type ContextOverride = "automatic" | "conversation-only" | "kailore-only" | "both" | "no-memory";
export type ConversationMode = "normal" | "writing" | "clean-room" | "temporary";

export type ContextRoutePlan = {
  schema_version: "1.0";
  decision: ContextDecision;
  sources: {
    recent_context: { include: boolean };
    conversation_archive: { include: boolean; queries: string[]; top_k: number; token_budget: number };
    kailore: { include: boolean; queries: string[]; top_k: number; token_budget: number };
  };
  intent_class: string;
  continuity_requirements: string[];
  reason_summary: string;
  confidence: number;
  fallback_used?: boolean;
};

export type ContextRoutingPacket = {
  currentMessage: string;
  recentTurns: Array<{ role: "user" | "assistant"; content: string }>;
  conversationTitle?: string;
  checkpoint?: string;
  kaiLoreEnabled: boolean;
  temporary: boolean;
  attachmentCount: number;
  override: ContextOverride;
  mode: ConversationMode;
  writingContinuityBias: boolean;
  budgets: { conversation: number; kailore: number; hybrid: number };
  availability: { conversation: boolean; kailore: boolean };
};

export type ContextSourceSummary = {
  decision: ContextDecision;
  label: string;
  conversationChunks: number;
  kaiLoreChunks: number;
  approximateTokens: number;
  checkpointUsed: boolean;
  confidence: number;
  reason: string;
  fallbackUsed: boolean;
};
