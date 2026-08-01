import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ignored = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", "vendor"]);
const textExtensions = new Set([".c", ".cpp", ".css", ".go", ".html", ".java", ".js", ".json", ".jsx", ".md", ".mjs", ".py", ".rs", ".sh", ".sql", ".swift", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);

export type PendingBuild = { id: string; owner: string; repo: string; defaultBranch: string; summary: string; securitySummary: string; files: { path: string; content: string }[]; verification: string[]; createdAt: string };

export function dataDirectory() {
  return process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.env.HOME ?? process.cwd(), ".promptdeck");
}

export async function command(file: string, args: string[], cwd?: string) {
  return execFileAsync(file, args, { cwd, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
}

export async function checkout(owner: string, repo: string) {
  const root = path.join(dataDirectory(), "github-builds");
  await mkdir(root, { recursive: true });
  const target = path.join(root, `${owner}--${repo}`);
  try {
    await stat(path.join(target, ".git"));
    await command("/usr/bin/git", ["fetch", "origin"], target);
    await command("/usr/bin/git", ["reset", "--hard", "origin/HEAD"], target);
  } catch {
    await command("/opt/homebrew/bin/gh", ["repo", "clone", `${owner}/${repo}`, target, "--", "--filter=blob:none"]);
  }
  return target;
}

export async function repositorySnapshot(root: string) {
  const files: { path: string; content: string }[] = [];
  const suspicious: string[] = [];
  let characters = 0;
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(absolute); continue; }
      const relative = path.relative(root, absolute);
      if (!textExtensions.has(path.extname(entry.name).toLowerCase()) && !["Dockerfile", "Makefile"].includes(entry.name)) continue;
      const info = await stat(absolute);
      if (info.size > 160_000) continue;
      const content = await readFile(absolute, "utf8");
      if (/ignore (all|any|previous)|system prompt|developer message|exfiltrat|credential|secret key|curl\s+.*\|\s*(sh|bash)|rm\s+-rf/i.test(content)) suspicious.push(relative);
      if (files.length < 140 && characters + content.length <= 650_000) { files.push({ path: relative, content }); characters += content.length; }
    }
  }
  await visit(root);
  return { files, suspicious };
}

export function safeTarget(root: string, requested: string) {
  if (!requested || path.isAbsolute(requested) || requested.includes("\0")) throw new Error("The coding agent proposed an invalid file path.");
  const target = path.resolve(root, requested);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`) || requested.startsWith(".git/")) throw new Error("The coding agent tried to write outside the repository.");
  return target;
}

export function encodeSnapshot(files: { path: string; content: string }[]) {
  return files.map((file) => `\n<file path="${file.path}">\n${file.content}\n</file>`).join("\n");
}

export async function savePendingBuild(build: PendingBuild) {
  const directory = path.join(dataDirectory(), "pending-github-builds");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${build.id}.json`), JSON.stringify(build), "utf8");
}

export async function readPendingBuild(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid build approval.");
  return JSON.parse(await readFile(path.join(dataDirectory(), "pending-github-builds", `${id}.json`), "utf8")) as PendingBuild;
}
