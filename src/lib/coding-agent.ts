import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { projectChecks, runBrowserChecks, runProjectChecks, safeReadTarget, safeWriteTarget, type CheckResult } from "@/lib/github-build";

const ignored = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", "vendor"]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export type AgentAction =
  | { status: string; tool: "inspect_tree"; path: string }
  | { status: string; tool: "read_file"; path: string; startLine: number; endLine: number }
  | { status: string; tool: "search"; path: string; query: string }
  | { status: string; tool: "write_file"; path: string; content: string }
  | { status: string; tool: "run_checks" }
  | { status: string; tool: "run_browser_checks" }
  | { status: string; tool: "inspect_screenshot"; path: string }
  | { status: string; tool: "finish"; summary: string };

export const agentActionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "tool"],
  properties: {
    status: { type: "string" },
    tool: { enum: ["inspect_tree", "read_file", "search", "write_file", "run_checks", "run_browser_checks", "inspect_screenshot", "finish"] },
    path: { type: "string" },
    query: { type: "string" },
    startLine: { type: "integer", minimum: 1 },
    endLine: { type: "integer", minimum: 1 },
    content: { type: "string" },
    summary: { type: "string" },
  },
} as const;

async function walk(root: string, relative = "", depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const directory = await safeDirectory(root, relative);
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => !ignored.has(entry.name) && !entry.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name));
  const lines: string[] = [];
  for (const entry of entries.slice(0, 120)) {
    const child = path.join(relative, entry.name);
    lines.push(`${"  ".repeat(depth)}${entry.isDirectory() ? "📁" : "📄"} ${child}`);
    if (entry.isDirectory() && lines.length < 400) lines.push(...await walk(root, child, depth + 1));
    if (lines.length >= 400) break;
  }
  return lines;
}

async function safeDirectory(root: string, requested: string) {
  if (!requested || requested === ".") return root;
  return safeReadTarget(root, requested);
}

export async function inspectTree(root: string, requested = ".") {
  return (await walk(root, requested === "." ? "" : requested)).join("\n").slice(0, 30_000);
}

export async function readScopedFile(root: string, requested: string, startLine = 1, endLine = 400) {
  const target = await safeReadTarget(root, requested);
  const info = await stat(target);
  if (info.size > 500_000) throw new Error("The requested file is too large for the coding agent.");
  const lines = (await readFile(target, "utf8")).split("\n");
  const start = Math.max(1, startLine);
  const end = Math.min(lines.length, Math.max(start, Math.min(endLine, start + 599)));
  return lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join("\n");
}

export async function searchScopedFiles(root: string, requested: string, query: string) {
  if (!query.trim() || query.length > 200) throw new Error("Search text must be between 1 and 200 characters.");
  const start = requested && requested !== "." ? await safeDirectory(root, requested) : root;
  const matches: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (matches.length >= 160 || ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(absolute); continue; }
      const info = await stat(absolute);
      if (info.size > 300_000 || imageExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      let content = "";
      try { content = await readFile(absolute, "utf8"); } catch { continue; }
      const needle = query.toLowerCase();
      content.split("\n").forEach((line, index) => {
        if (matches.length < 160 && line.toLowerCase().includes(needle)) matches.push(`${path.relative(root, absolute)}:${index + 1}: ${line.slice(0, 500)}`);
      });
    }
  }
  await visit(start);
  return matches.length ? matches.join("\n") : "No matches found.";
}

export async function writeScopedFile(root: string, requested: string, content: string) {
  if (content.length > 500_000) throw new Error("A single proposed file exceeds the 500 KB safety limit.");
  const target = await safeWriteTarget(root, requested);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return `Wrote ${requested} (${content.length} characters).`;
}

export async function listScreenshots(root: string) {
  const results: string[] = [];
  async function visit(directory: string, depth: number) {
    if (depth > 5 || results.length >= 30) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, depth + 1);
      else if (imageExtensions.has(path.extname(entry.name).toLowerCase())) results.push(path.relative(root, absolute));
      if (results.length >= 30) break;
    }
  }
  for (const candidate of ["screenshots", "test-results", "playwright-report"]) {
    try { await visit(await safeDirectory(root, candidate), 0); } catch { /* Optional artifact directory. */ }
  }
  return results;
}

export async function screenshotPayload(root: string, requested: string) {
  if (!imageExtensions.has(path.extname(requested).toLowerCase())) throw new Error("Only PNG, JPEG, or WebP screenshots can be inspected.");
  const target = await safeReadTarget(root, requested);
  const info = await stat(target);
  if (info.size > 8 * 1024 * 1024) throw new Error("The screenshot exceeds the 8 MB inspection limit.");
  return (await readFile(target)).toString("base64");
}

export async function executeAgentAction(root: string, action: AgentAction): Promise<{ result: string; checks?: CheckResult[]; image?: string }> {
  switch (action.tool) {
    case "inspect_tree": return { result: await inspectTree(root, action.path || ".") };
    case "read_file": return { result: await readScopedFile(root, action.path, action.startLine, action.endLine) };
    case "search": return { result: await searchScopedFiles(root, action.path || ".", action.query) };
    case "write_file": return { result: await writeScopedFile(root, action.path, action.content) };
    case "run_checks": {
      const checks = await runProjectChecks(root);
      return { checks, result: checks.length ? checks.map((check) => `${check.passed ? "PASS" : "FAIL"} ${check.name}\n${check.output}`).join("\n\n") : "No declared lint, typecheck, test, test:e2e, or build scripts were detected." };
    }
    case "run_browser_checks": {
      const check = await runBrowserChecks(root);
      const screenshots = await listScreenshots(root);
      return { checks: [check], result: `${check.passed ? "PASS" : "FAIL"} ${check.name}\n${check.output}\n\nScreenshots:\n${screenshots.join("\n") || "None produced."}` };
    }
    case "inspect_screenshot": return { result: `Screenshot attached: ${action.path}`, image: await screenshotPayload(root, action.path) };
    case "finish": return { result: action.summary };
  }
}

export async function availableToolSummary(root: string) {
  const checks = await projectChecks(root);
  return `Available tools: inspect_tree, read_file, search, write_file, run_checks${checks.some((check) => check.name === "test:e2e") ? ", run_browser_checks, inspect_screenshot" : ""}, finish.`;
}
