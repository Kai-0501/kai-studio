export type OwnedGitHubRepository = {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string;
  url: string;
  defaultBranch: string;
  language: string;
  topics: string[];
  private: boolean;
  updatedAt: string;
  readme: string;
};

export type GitHubVaultStatus = {
  connected: boolean;
  login: string;
  repositories: OwnedGitHubRepository[];
  repositoryCount: number;
  syncedAt: string | null;
  stale?: boolean;
  error?: string;
};
