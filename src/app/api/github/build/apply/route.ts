import { mkdir, writeFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { checkout, command, prepareBuildBranch, readPendingBuild, runProjectChecks, safeTarget, saveAppliedBuild } from "@/lib/github-build";
import { findOwnedRepository } from "@/lib/github-vault";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { buildId?: unknown };
    if (typeof body.buildId !== "string") return Response.json({ error: "Build approval is required." }, { status: 400 });
    const build = await readPendingBuild(body.buildId);
    const repository = await findOwnedRepository(build.owner, build.repo);
    if (!repository) return Response.json({ error: "Repository ownership could not be reconfirmed." }, { status: 403 });
    const root = await checkout(build.owner, build.repo);
    const branch = await prepareBuildBranch(root, build.defaultBranch, build.id);
    const baseline = await runProjectChecks(root);
    for (const file of build.files) {
      const target = safeTarget(root, file.path);
      await mkdir(target.substring(0, target.lastIndexOf("/")), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
    const status = (await command("/usr/bin/git", ["status", "--porcelain"], root)).stdout.trim();
    if (!status) return Response.json({ message: "The repository already matches the approved implementation." });
    const checks = await runProjectChecks(root);
    const newFailures = checks.filter((check) => !check.passed && !baseline.some((before) => before.name === check.name && !before.passed));
    if (newFailures.length) {
      await command("/usr/bin/git", ["reset", "--hard", `origin/${build.defaultBranch}`], root);
      return Response.json({ error: `Verification failed and the coding branch was restored: ${newFailures.map((failure) => failure.name).join(", ")}.`, checks }, { status: 422 });
    }
    await command("/usr/bin/git", ["add", "--all"], root);
    await command("/usr/bin/git", ["commit", "-m", "Implement approved Kai Studio build"], root);
    const commit = (await command("/usr/bin/git", ["rev-parse", "HEAD"], root)).stdout.trim();
    await saveAppliedBuild({ buildId: build.id, owner: build.owner, repo: build.repo, branch, summary: build.summary, checks, commit, createdAt: new Date().toISOString() });
    return Response.json({ message: `Applied ${build.files.length} files on a local review branch. ${checks.length ? `${checks.filter((check) => check.passed).length}/${checks.length} checks passed.` : "No project test commands were detected."}`, readyToPush: true, buildId: build.id, branch, checks });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The approved build could not be applied." }, { status: 500 });
  }
}
