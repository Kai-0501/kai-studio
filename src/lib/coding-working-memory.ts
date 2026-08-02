import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory, type CheckResult } from "@/lib/github-build";
import type { AgentAction } from "@/lib/coding-agent";
import type { CanonicalMessage } from "@/lib/models/types";

type WorkingEvent = {
  at: string;
  action?: AgentAction;
  result?: string;
  checks?: CheckResult[];
  feedback?: string;
  note?: string;
};

/**
 * Three-tier working memory for bounded coding loops.
 * Hot: recent exact turns sent to the model.
 * Warm: structured action/file/check ledger sent as a compact checkpoint.
 * Cold: the complete lossless event stream persisted on disk for auditing.
 */
export class CodingWorkingMemory {
  private hot: CanonicalMessage[] = [];
  private actions: string[] = [];
  private files = new Set<string>();
  private latestChecks: CheckResult[] = [];
  private blockers: string[] = [];
  private readonly logFile: string;

  private constructor(private readonly base: CanonicalMessage[], buildId: string) {
    this.logFile = path.join(dataDirectory(), "coding-working-memory", `${buildId}.jsonl`);
  }

  static async create(base: CanonicalMessage[], buildId: string) {
    const memory = new CodingWorkingMemory(base, buildId);
    await mkdir(path.dirname(memory.logFile), { recursive: true });
    await writeFile(memory.logFile, "", "utf8");
    return memory;
  }

  async record(action: AgentAction, result: string, checks?: CheckResult[], image?: string) {
    const event: WorkingEvent = { at: new Date().toISOString(), action, result, checks };
    await appendFile(this.logFile, `${JSON.stringify(event)}\n`, "utf8");
    this.actions.push(`${action.tool}: ${action.status}`);
    if (this.actions.length > 24) this.actions.shift();
    if (action.tool === "write_file") this.files.add(action.path);
    if (checks) this.latestChecks = checks;
    this.hot.push({ role: "assistant", content: JSON.stringify(action) });
    this.hot.push({ role: "user", content: image
      ? [{ type: "text", text: `Tool result:\n${result.slice(0, 40_000)}` }, { type: "image", data: image, mimeType: "image/png" }]
      : `Tool result:\n${result.slice(0, 40_000)}` });
    this.trimHot();
  }

  async feedback(action: AgentAction, feedback: string) {
    await appendFile(this.logFile, `${JSON.stringify({ at: new Date().toISOString(), action, feedback } satisfies WorkingEvent)}\n`, "utf8");
    this.blockers.push(feedback.slice(0, 3_000));
    if (this.blockers.length > 5) this.blockers.shift();
    this.hot.push({ role: "assistant", content: JSON.stringify(action) }, { role: "user", content: feedback });
    this.trimHot();
  }

  async note(note: string) {
    await appendFile(this.logFile, `${JSON.stringify({ at: new Date().toISOString(), note } satisfies WorkingEvent)}\n`, "utf8");
    this.hot.push({ role: "system", content: `RUNTIME NOTE: ${note}` });
    this.trimHot();
  }

  async checkpoint() {
    await appendFile(this.logFile, `${JSON.stringify({ at: new Date().toISOString(), note: "Warm memory checkpoint persisted." } satisfies WorkingEvent)}\n`, "utf8");
  }

  context(): CanonicalMessage[] {
    if (!this.actions.length) return this.base;
    const checkpoint: CanonicalMessage = {
      role: "system",
      content: `CODING SESSION CHECKPOINT (trusted runtime summary)\nCompleted actions:\n${this.actions.join("\n")}\n\nFiles written:\n${[...this.files].join("\n") || "None"}\n\nLatest checks:\n${this.latestChecks.map((check) => `${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.output.slice(-1_500)}`).join("\n") || "Not run yet"}\n\nActive blockers or reviewer feedback:\n${this.blockers.join("\n---\n") || "None"}\n\nOlder raw tool output is archived on disk to avoid KV-cache growth. Re-read a file or rerun a check whenever exact evidence is needed; never guess from this checkpoint.`,
    };
    return [...this.base, checkpoint, ...this.hot];
  }

  private trimHot() {
    const maxMessages = 8;
    const maxCharacters = 120_000;
    while (this.hot.length > maxMessages || this.hot.reduce((sum, message) => sum + (typeof message.content === "string" ? message.content.length : JSON.stringify(message.content).length), 0) > maxCharacters) {
      this.hot.splice(0, Math.min(2, this.hot.length));
    }
  }
}
