import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeMemory, memoryStatus } from "@/lib/memory-store";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);

export async function POST() {
  try {
    const gh = process.env.KAI_STUDIO_GH_PATH || "/opt/homebrew/bin/gh";
    const { stdout } = await execFileAsync(gh, ["api", "repos/Kai-0501/kai-memory-cloud/contents/memory/current.md", "-H", "Accept: application/vnd.github.raw+json"], { timeout: 30_000, maxBuffer: 256_000 });
    if (!stdout.trim() || stdout.length > 120_000) throw new Error("The cloud memory file is empty or too large.");
    return Response.json(memoryStatus(await writeMemory(stdout, "KaiLore cloud memory")));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Cloud memory could not be synced." }, { status: 503 });
  }
}
