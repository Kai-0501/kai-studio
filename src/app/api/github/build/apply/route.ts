import { mkdir, writeFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { checkout, command, readPendingBuild, safeTarget } from "@/lib/github-build";
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
    for (const file of build.files) {
      const target = safeTarget(root, file.path);
      await mkdir(target.substring(0, target.lastIndexOf("/")), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
    const status = (await command("/usr/bin/git", ["status", "--porcelain"], root)).stdout.trim();
    if (!status) return Response.json({ message: "The repository already matches the approved implementation." });
    await command("/usr/bin/git", ["add", "--all"], root);
    await command("/usr/bin/git", ["commit", "-m", "Implement approved Kai Studio build"], root);
    await command("/usr/bin/git", ["push", "origin", `HEAD:${build.defaultBranch}`], root);
    return Response.json({ message: `Applied, committed, and pushed ${build.files.length} files to ${build.owner}/${build.repo}.` });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The approved build could not be applied." }, { status: 500 });
  }
}
