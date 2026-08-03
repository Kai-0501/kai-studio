import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { greenfieldTemplates, getGreenfieldTemplate } from "../src/lib/greenfield-templates.ts";

const greenfieldRoot = await mkdtemp(path.join(os.tmpdir(), "kai-greenfield-smoke-"));
process.env.KAI_GREENFIELD_ROOT = greenfieldRoot;
const { approveGreenfieldRoot, scaffoldGreenfield } = await import(`../src/lib/greenfield-workspace.ts?smoke=${crypto.randomUUID()}`);
const run = promisify(execFile);

test("greenfield registry exposes the bounded starter templates", () => {
  assert.equal(greenfieldTemplates.length, 3);
  assert.equal(getGreenfieldTemplate("nextjs")?.commands.test, "npm test");
  assert.equal(getGreenfieldTemplate("unknown"), null);
});

test("greenfield smoke creates, verifies, and commits a disposable local application", async () => {
  const { projectRoot } = await scaffoldGreenfield(greenfieldRoot, "node-service", "smoke-app");
  await run("npm", ["test"], { cwd: projectRoot });
  await run("npm", ["run", "lint"], { cwd: projectRoot });
  await run("npm", ["run", "build"], { cwd: projectRoot });
  await run("/usr/bin/git", ["add", "--all"], { cwd: projectRoot });
  await run("/usr/bin/git", ["-c", "user.name=Kai Studio Smoke", "-c", "user.email=kai-studio-smoke@local", "commit", "-m", "Create verified greenfield smoke app"], { cwd: projectRoot });
  const status = await run("/usr/bin/git", ["status", "--porcelain"], { cwd: projectRoot });
  assert.equal(status.stdout.trim(), "");
  assert.match(await readFile(path.join(projectRoot, "README.md"), "utf8"), /Node\.js utility or service/);
});

test("greenfield canonical paths allow macOS aliases but reject a symlink escape", async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "kai-greenfield-outside-"));
  const escape = path.join(greenfieldRoot, "escape");
  await symlink(outside, escape);
  await assert.rejects(() => approveGreenfieldRoot(escape), /may not escape/);
});
