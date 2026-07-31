import { readGitHubCache, syncOwnedGitHubRepositories } from "@/lib/github-vault";

export const runtime = "nodejs";

export async function POST() {
  try {
    const cache = await syncOwnedGitHubRepositories();
    return Response.json({ connected: true, ...cache, repositoryCount: cache.repositories.length });
  } catch (failure) {
    const cache = await readGitHubCache();
    return Response.json({
      connected: Boolean(cache.login),
      ...cache,
      repositoryCount: cache.repositories.length,
      stale: true,
      error: failure instanceof Error ? failure.message : "GitHub sync failed.",
    });
  }
}
