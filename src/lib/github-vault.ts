import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { OwnedGitHubRepository } from "@/types/github";

const execFileAsync = promisify(execFile);

type CacheFile = {
  login: string;
  repositories: OwnedGitHubRepository[];
  syncedAt: string;
};

function dataDirectory() {
  return process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.env.HOME ?? process.cwd(), ".promptdeck");
}

function cachePath() {
  return path.join(dataDirectory(), "github-owned-repositories.json");
}

async function ghPath() {
  const candidates = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next standard macOS install location.
    }
  }
  return "gh";
}

async function gh(args: string[]) {
  const { stdout } = await execFileAsync(await ghPath(), args, {
    maxBuffer: 24 * 1024 * 1024,
    timeout: 45_000,
  });
  return stdout;
}

export async function readGitHubCache(): Promise<CacheFile> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(), "utf8")) as CacheFile;
    const login = typeof parsed.login === "string" ? parsed.login : "";
    const repositories = Array.isArray(parsed.repositories)
      ? parsed.repositories.filter(
          (repository) => repository.owner.toLowerCase() === login.toLowerCase(),
        )
      : [];
    return { login, repositories, syncedAt: parsed.syncedAt ?? "" };
  } catch {
    return { login: "", repositories: [], syncedAt: "" };
  }
}

async function writeGitHubCache(cache: CacheFile) {
  await mkdir(dataDirectory(), { recursive: true });
  const target = cachePath();
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(cache, null, 2), "utf8");
  await rename(temporary, target);
  return cache;
}

type ApiRepository = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  html_url: string;
  default_branch: string;
  language: string | null;
  topics?: string[];
  private: boolean;
  fork: boolean;
  updated_at: string;
};

export async function syncOwnedGitHubRepositories() {
  const user = JSON.parse(await gh(["api", "user"])) as { login?: string };
  const login = user.login?.trim() ?? "";
  if (!login) throw new Error("GitHub CLI is not signed in.");

  const response = JSON.parse(
    await gh(["api", "user/repos?affiliation=owner&per_page=100&sort=updated"]),
  ) as ApiRepository[];
  const owned = response
    .filter(
      (repository) =>
        repository.owner.login.toLowerCase() === login.toLowerCase() &&
        repository.fork === false,
    )
    .slice(0, 40);

  const repositories: OwnedGitHubRepository[] = [];
  for (let offset = 0; offset < owned.length; offset += 5) {
    const batch = owned.slice(offset, offset + 5);
    repositories.push(
      ...(await Promise.all(
        batch.map(async (repository) => {
          let readme = "";
          try {
            readme = await gh([
              "api",
              `repos/${login}/${repository.name}/readme`,
              "-H",
              "Accept: application/vnd.github.raw+json",
            ]);
          } catch {
            // Repositories do not need a README to appear in the vault.
          }
          return {
            id: repository.id,
            name: repository.name,
            fullName: repository.full_name,
            owner: login,
            description: repository.description ?? "",
            url: repository.html_url,
            defaultBranch: repository.default_branch,
            language: repository.language ?? "",
            topics: repository.topics ?? [],
            private: repository.private,
            updatedAt: repository.updated_at,
            readme: readme.trim(),
          };
        }),
      )),
    );
  }

  return writeGitHubCache({ login, repositories, syncedAt: new Date().toISOString() });
}

export async function findOwnedRepository(owner: string, name: string) {
  const cache = await readGitHubCache();
  if (owner.toLowerCase() !== cache.login.toLowerCase()) return null;
  return (
    cache.repositories.find(
      (repository) =>
        repository.owner.toLowerCase() === cache.login.toLowerCase() &&
        repository.name === name,
    ) ?? null
  );
}
