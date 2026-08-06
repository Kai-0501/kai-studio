export type FollowUpMessage = {
  id?: string;
  parentId?: string | null;
  branchId?: string;
  revision?: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  updatedAt?: string;
  contentHash?: string;
  deletedAt?: string | null;
};

export type ConversationMessage = Required<Pick<FollowUpMessage, "id" | "branchId" | "revision" | "role" | "content" | "createdAt" | "updatedAt" | "contentHash">> & {
  parentId: string | null;
  deletedAt: string | null;
};

export type ConversationCheckpoint = {
  version: number;
  conversationId: string;
  branchId: string;
  throughMessageId: string;
  sourceMessageIds: string[];
  currentTopic: string;
  currentObjective: string;
  importantEntities: string[];
  establishedFacts: string[];
  decisions: string[];
  unresolvedQuestions: string[];
  constraints: string[];
  nextContinuationPoint: string;
  updatedAt: string;
  contentHash: string;
};

export type DiagnosticPriority =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "user-request";

export type DiagnosticRecommendation = {
  id: string;
  priority: DiagnosticPriority;
  title: string;
  summary: string;
  evidence: string;
  acceptanceCriteria: string[];
  severity?: "critical" | "high" | "medium" | "low" | "info" | "unknown";
  severityInferred?: boolean;
  category?: string;
  description?: string;
  affectedFiles?: string[];
  recommendedAction?: string;
  confidence?: "high" | "medium" | "low" | "unknown";
  runtimeVerificationRequired?: boolean;
  classification?: "reproducible bug" | "architectural brittleness" | "UX friction" | "reliability issue" | "security issue" | "future-proofing improvement" | "optional enhancement" | "unknown";
};

export type SavedRun = {
  schemaVersion?: 1 | 2;
  id: string;
  title?: string;
  workflowId: string;
  workflowName: string;
  accountName: string;
  salespersonName: string;
  inputLabel?: string;
  transcript: string;
  compiledPrompt: string;
  model: string;
  output: string;
  followUps?: FollowUpMessage[];
  activeBranchId?: string;
  messages?: ConversationMessage[];
  checkpoint?: ConversationCheckpoint;
  diagnosticsRecommendations?: DiagnosticRecommendation[];
  diagnosticsPlan?: string;
  diagnosticSelectedRecommendationIds?: string[];
  createdAt: string;
};
