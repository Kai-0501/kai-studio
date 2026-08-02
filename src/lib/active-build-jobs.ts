export type ActiveBuildEvent = {
  type: "progress" | "final" | "error";
  message?: string;
  content?: string;
  error?: string;
  readyToPush?: boolean;
  buildId?: string;
  paused?: boolean;
  implementationStepCount?: number;
  inspectionCount?: number;
  stepLimit?: number;
  extensionCount?: number;
  awaitingExtension?: boolean;
};

export type ActiveBuildJob = {
  id: string;
  owner: string;
  repo: string;
  task: string;
  diagnosticRunId?: string;
  status: "running" | "complete" | "failed";
  events: ActiveBuildEvent[];
  createdAt: string;
  updatedAt: string;
  pendingBuildId?: string;
  implementationStepCount?: number;
  inspectionCount?: number;
  stepLimit?: number;
  extensionCount?: number;
  awaitingExtension?: boolean;
};

const globalJobs = globalThis as typeof globalThis & {
  __kaiStudioActiveBuildJobs?: Map<string, ActiveBuildJob>;
};

export const activeBuildJobs =
  globalJobs.__kaiStudioActiveBuildJobs ?? new Map<string, ActiveBuildJob>();
globalJobs.__kaiStudioActiveBuildJobs = activeBuildJobs;

export function publicActiveBuild(job: ActiveBuildJob) {
  return {
    ...job,
    href: `/chat/github/${encodeURIComponent(job.owner)}/${encodeURIComponent(job.repo)}?job=${encodeURIComponent(job.id)}`,
  };
}
