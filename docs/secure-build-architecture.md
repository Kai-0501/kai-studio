# Secure build architecture

Kai Studio's repository builder separates security review from implementation.
The agents run sequentially and have different authority.

## Stage 1: bounded security preflight

The security model receives a bounded repository snapshot and treats every
repository file as untrusted data. It may approve, reject, or return sanitized
instructions. It cannot write files or invoke the coding tools. Repositories
outside the authenticated owner's non-fork allowlist are never eligible.

## Stage 2: tool-using coding agent

Only an approved or sanitized task reaches the coding model. The coding agent
works inside an isolated checkout and can:

- inspect the repository tree;
- read bounded line ranges;
- search scoped files;
- write files inside the checkout;
- run declared project checks;
- run browser checks and inspect resulting screenshots when available; and
- finish with a concrete implementation summary.

Path traversal, symlink escape, oversized files, broad shell access, and writes
outside the checkout are rejected. The result remains staged for human review;
publishing is a separate explicit action.

## Coding-session memory

Coding uses a dedicated three-tier working-memory system. It does **not** load
KaiLore personal memory.

- **Hot:** the latest exact model/tool exchanges, capped by message and
  character budgets.
- **Warm:** a trusted checkpoint of completed actions, written files, latest
  checks, and current blockers.
- **Cold:** a lossless local JSONL event stream for debugging and audit.

When exact evidence ages out of hot context, the model is instructed to re-read
the file or rerun the check rather than infer from a summary. This bounds KV
cache growth without discarding repository evidence or weakening verification.

## Durable user experience

Active build jobs are registered independently from page components. Their
progress can be reopened after navigating elsewhere in Kai Studio, and the
desktop shell prevents ordinary background throttling from terminating a build.
Progress messages are temporary; the completed chat retains the final result
and review actions.
