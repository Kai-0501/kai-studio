import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { projectChecks, safeReadTarget, safeTarget, safeWriteTarget } from "@/lib/github-build";
import { executeAgentAction, inspectTree, searchScopedFiles } from "@/lib/coding-agent";

test("scoped filesystem blocks traversal and .git writes", () => {
  const root = "/tmp/kai-studio-project";
  assert.equal(safeTarget(root, "src/app.ts"), path.join(root, "src/app.ts"));
  assert.throws(() => safeTarget(root, "../secrets.txt"));
  assert.throws(() => safeTarget(root, ".git/config"));
  assert.throws(() => safeTarget(root, "src/../.git/config"));
  assert.throws(() => safeTarget(root, "/etc/hosts"));
});

test("scoped writes refuse repository symlink escapes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kai-build-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "kai-build-outside-"));
  await symlink(outside, path.join(root, "linked"));
  await assert.rejects(() => safeWriteTarget(root, "linked/secret.txt"), /symlink/);
  await assert.rejects(() => safeReadTarget(root, "linked"), /symlink/);
});

test("coding tools inspect, search, write, and report declared checks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kai-agent-tools-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.ts"), "export const answer = 41;\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  assert.match(await inspectTree(root), /src\/app\.ts/);
  assert.match(await searchScopedFiles(root, ".", "answer"), /src\/app\.ts:1/);
  const write = await executeAgentAction(root, { status: "Fixing the value.", tool: "write_file", path: "src/app.ts", content: "export const answer = 42;\n" });
  assert.match(write.result, /Wrote src\/app\.ts/);
});

test("test runner exposes only declared project checks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kai-build-tools-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { lint: "eslint", test: "vitest", deploy: "dangerous" } }));
  const checks = await projectChecks(root);
  assert.deepEqual(checks.map((check) => check.name), ["lint", "test"]);
  assert.ok(checks.every((check) => check.file === "/opt/homebrew/bin/npm"));
});
