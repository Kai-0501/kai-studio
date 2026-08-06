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

## Federated coding-session memory

Coding uses a dedicated federated three-tier working-memory system. It does
**not** load personal memory. Planner, implementer, and reviewer are
separate logical sessions scheduled sequentially against one loaded coding
model.

- **Hot:** the latest exact model/tool exchanges, capped by message and
  character budgets.
- **Warm:** a trusted checkpoint of completed actions, written files, latest
  checks, and current blockers.
- **Cold:** a lossless local JSONL event stream for debugging and audit.

Private checkpoints never become shared prompts. Cross-agent coordination is a
separate bounded, versioned record with a task graph, repository identity,
leased write reservations, test state, blockers, decisions, and handoff queue.
Optimistic version checks, reservation leases, and repository identities block
stale or conflicting writes. Handoffs are structured and acknowledged only
after the receiver validates their evidence and current repository state.

When exact evidence ages out of hot context, the model is instructed to re-read
the file or rerun the check rather than infer from a summary. This bounds KV
cache growth without discarding repository evidence or weakening verification.
Context is proactively compacted under a configurable 16K or 32K budget, with
dedicated allocations for instructions, scope, exact evidence, coordination,
warm state, recent tools, and response headroom.

The three roles share one coding-model weight residency but never share live KV
state. The default policy checkpoints and reconstructs inactive logical
sessions at each role boundary. Planner output reaches the implementer only as
a validated handoff; reviewer findings return through the same bounded path.
The runtime uses a reference-counted outer coding lease so nested generation
does not reload the weights between roles.

Memory pressure is evaluated before the lease is acquired. The conservative
order is: evict eligible idle coding retrieval, request safe release of idle
KaiLore and diagnostics/orchestration residencies, reduce a requested 32K
context to 16K, then apply the configured single-agent or pause fallback. No
active lease, external runtime, personal file, or unrelated model is unloaded
to make room for coding.

## Durable user experience

Active build jobs are registered independently from page components. Their
progress can be reopened after navigating elsewhere in Kai Studio, and the
desktop shell prevents ordinary background throttling from terminating a build.
Progress messages are temporary; the completed chat retains the final result
and review actions.

The runtime also maintains a task-aware time budget. Deterministic progress can
earn bounded five-minute continuations; ambiguous progress alone may be assessed
by the configured 12B progress role. At the boundary, state is preserved while
the user chooses +15 minutes, +30 minutes, stop for review, or cancel. Resource,
sandbox, cancellation, and non-progress guards remain independent.
