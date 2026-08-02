export type FollowUpMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
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
  diagnosticsRecommendations?: DiagnosticRecommendation[];
  diagnosticsPlan?: string;
  diagnosticSelectedRecommendationIds?: string[];
  createdAt: string;
};
