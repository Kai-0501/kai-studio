import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { projectChecks, safeTarget } from "@/lib/github-build";

test("scoped filesystem blocks traversal and .git writes", () => {
  const root = "/tmp/kai-studio-project";
  assert.equal(safeTarget(root, "src/app.ts"), path.join(root, "src/app.ts"));
  assert.throws(() => safeTarget(root, "../secrets.txt"));
  assert.throws(() => safeTarget(root, ".git/config"));
  assert.throws(() => safeTarget(root, "/etc/hosts"));
});

test("test runner exposes only declared project checks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kai-build-tools-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { lint: "eslint", test: "vitest", deploy: "dangerous" } }));
  const checks = await projectChecks(root);
  assert.deepEqual(checks.map((check) => check.name), ["lint", "test"]);
  assert.ok(checks.every((check) => check.file === "/opt/homebrew/bin/npm"));
});
