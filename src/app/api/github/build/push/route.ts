import { NextRequest } from "next/server";
import { checkout, command, readAppliedBuild } from "@/lib/github-build";
import { findOwnedRepository } from "@/lib/github-vault";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { buildId?: unknown };
    if (typeof body.buildId !== "string") return Response.json({ error: "A reviewed local build is required." }, { status: 400 });
    const build = await readAppliedBuild(body.buildId);
    const repository = await findOwnedRepository(build.owner, build.repo);
    if (!repository) return Response.json({ error: "Repository ownership could not be reconfirmed." }, { status: 403 });
    const root = await checkout(build.owner, build.repo);
    await command("/usr/bin/git", ["checkout", build.branch], root);
    const currentCommit = (await command("/usr/bin/git", ["rev-parse", "HEAD"], root)).stdout.trim();
    if (currentCommit !== build.commit) throw new Error("The local review branch changed after verification. Run the build again.");
    await command("/usr/bin/git", ["push", "--set-upstream", "origin", build.branch], root);
    const result = await command("/opt/homebrew/bin/gh", ["pr", "create", "--repo", `${build.owner}/${build.repo}`, "--draft", "--base", repository.defaultBranch, "--head", build.branch, "--title", build.summary.slice(0, 120), "--body", `## Kai Studio build\n\n${build.summary}\n\n## Verification\n${build.checks.map((check) => `- ${check.passed ? "✅" : "⚠️"} ${check.name} (${check.durationMs} ms)`).join("\n") || "- No project checks were detected."}`], root);
    return Response.json({ message: "Pushed the verified branch and opened a draft pull request.", url: result.stdout.trim() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The reviewed branch could not be pushed." }, { status: 500 });
  }
}
