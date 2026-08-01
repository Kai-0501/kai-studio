import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ignored = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", "vendor"]);
const textExtensions = new Set([".c", ".cpp", ".css", ".go", ".html", ".java", ".js", ".json", ".jsx", ".md", ".mjs", ".py", ".rs", ".sh", ".sql", ".swift", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);

export type PendingBuild = { id: string; owner: string; repo: string; defaultBranch: string; task: string; summary: string; securitySummary: string; files: { path: string; content: string }[]; verification: string[]; createdAt: string };
export type AppliedBuild = { buildId: string; owner: string; repo: string; branch: string; summary: string; checks: CheckResult[]; commit: string; createdAt: string };
export type CheckResult = { name: string; command: string; passed: boolean; output: string; durationMs: number };

export function dataDirectory() {
  return process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.env.HOME ?? process.cwd(), ".promptdeck");
}

export async function command(file: string, args: string[], cwd?: string) {
  return execFileAsync(file, args, { cwd, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
}

export async function checkout(owner: string, repo: string) {
  const root = path.join(dataDirectory(), "github-builds");
  await mkdir(root, { recursive: true });
  const target = path.join(root, `${owner}--${repo}`);
  try {
    await stat(path.join(target, ".git"));
    await command("/usr/bin/git", ["fetch", "origin"], target);
    await command("/usr/bin/git", ["checkout", "--detach", "origin/HEAD"], target);
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
  const relative = path.relative(path.resolve(root), target);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`) || relative.split(path.sep).includes(".git")) throw new Error("The coding agent tried to write outside the repository.");
  return target;
}

export async function safeWriteTarget(root: string, requested: string) {
  const target = safeTarget(root, requested);
  const relative = path.relative(path.resolve(root), target);
  let cursor = path.resolve(root);
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    cursor = path.join(cursor, segment);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error("The coding agent tried to write through a repository symlink.");
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (failure.code !== "ENOENT") throw error;
      break;
    }
  }
  return target;
}

export async function safeReadTarget(root: string, requested: string) {
  const target = safeTarget(root, requested);
  const relative = path.relative(path.resolve(root), target);
  let cursor = path.resolve(root);
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error("The coding agent tried to read through a repository symlink.");
  }
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

export async function prepareBuildBranch(root: string, defaultBranch: string, buildId: string) {
  const branch = `kai-studio/build-${buildId.slice(0, 8)}`;
  await command("/usr/bin/git", ["fetch", "origin", defaultBranch], root);
  await command("/usr/bin/git", ["checkout", "-B", branch, `origin/${defaultBranch}`], root);
  return branch;
}

export async function projectChecks(root: string): Promise<{ name: string; file: string; args: string[] }[]> {
  try {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const scripts = manifest.scripts || {};
    const names = ["lint", "typecheck", "test", "test:e2e", "build"].filter((name) => typeof scripts[name] === "string");
    return names.map((name) => ({ name, file: "/opt/homebrew/bin/npm", args: ["run", name, "--if-present"] }));
  } catch {
    if (await exists(path.join(root, "Cargo.toml"))) return [{ name: "cargo-test", file: "/opt/homebrew/bin/cargo", args: ["test"] }];
    if (await exists(path.join(root, "Package.swift"))) return [{ name: "swift-test", file: "/usr/bin/swift", args: ["test"] }];
    if (await exists(path.join(root, "pyproject.toml"))) return [{ name: "pytest", file: "/opt/homebrew/bin/python3", args: ["-m", "pytest"] }];
    return [];
  }
}

async function exists(target: string) { try { await stat(target); return true; } catch { return false; } }

export async function runProjectChecks(root: string): Promise<CheckResult[]> {
  const checks = await projectChecks(root);
  const results: CheckResult[] = [];
  for (const check of checks) {
    const started = Date.now();
    try {
      const result = await command(check.file, check.args, root);
      results.push({ name: check.name, command: `${path.basename(check.file)} ${check.args.join(" ")}`, passed: true, output: `${result.stdout || ""}${result.stderr || ""}`.slice(-12_000), durationMs: Date.now() - started });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      results.push({ name: check.name, command: `${path.basename(check.file)} ${check.args.join(" ")}`, passed: false, output: `${failure.stdout || ""}${failure.stderr || ""}${failure.message || ""}`.slice(-12_000), durationMs: Date.now() - started });
    }
  }
  return results;
}

export async function runBrowserChecks(root: string): Promise<CheckResult> {
  const checks = await projectChecks(root);
  const browser = checks.find((check) => check.name === "test:e2e");
  if (!browser) return { name: "test:e2e", command: "not configured", passed: false, output: "This repository does not declare a test:e2e script.", durationMs: 0 };
  const started = Date.now();
  try {
    const result = await command(browser.file, browser.args, root);
    return { name: browser.name, command: `${path.basename(browser.file)} ${browser.args.join(" ")}`, passed: true, output: `${result.stdout || ""}${result.stderr || ""}`.slice(-12_000), durationMs: Date.now() - started };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    return { name: browser.name, command: `${path.basename(browser.file)} ${browser.args.join(" ")}`, passed: false, output: `${failure.stdout || ""}${failure.stderr || ""}${failure.message || ""}`.slice(-12_000), durationMs: Date.now() - started };
  }
}

export async function saveAppliedBuild(build: AppliedBuild) {
  const directory = path.join(dataDirectory(), "applied-github-builds");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${build.buildId}.json`), JSON.stringify(build), "utf8");
}

export async function readAppliedBuild(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid build approval.");
  return JSON.parse(await readFile(path.join(dataDirectory(), "applied-github-builds", `${id}.json`), "utf8")) as AppliedBuild;
}
