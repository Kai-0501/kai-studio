import { readGitHubCache, syncOwnedGitHubRepositories } from "@/lib/github-vault";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  if (refresh) {
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

  const cache = await readGitHubCache();
  return Response.json({
    connected: Boolean(cache.login),
    ...cache,
    repositoryCount: cache.repositories.length,
  });
}
