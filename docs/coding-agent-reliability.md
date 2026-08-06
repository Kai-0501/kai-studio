# Coding-agent reliability, memory, and greenfield boundaries

## Federated hybrid coding memory

One coding model can host several logical agent sessions sequentially. Kai
Studio currently provisions planner, implementer, and reviewer identities. Only
one identity owns the execution token at a time, so the model weights are not
duplicated in memory.

Each logical agent has private hot context and a versioned warm checkpoint.
Private checkpoints record assigned subtasks, hypotheses, exact files read,
files changed, tools used, blockers, approvals, repository identity, pending
actions, and compaction state. Agents do not read each other's private memory.

Cross-agent facts live in a bounded, versioned shared coordination record. It
contains only the approved objective and scope, task graph, constraints,
acceptance criteria, shared decisions, repository identity, leased file or
subsystem reservations, integration queue, global test state, cross-agent
blockers, approvals, and execution ownership. Optimistic version checks reject
stale writers. An append-only JSONL audit records coordination changes.

Cold memory is one append-only JSONL event ledger per task. Every event carries
task, agent, subtask, repository-state, event-type, outcome, and timestamp
provenance. Agent retrieval remains private by default: it reads only that
agent's events unless a validated handoff explicitly requests other evidence.
Retrieval reads a bounded tail, filters by task, agent, subtask, file, tool,
event type, outcome, repository state, and time, ranks a bounded candidate set,
then restores chronological order. Historical evidence from an older
repository identity is labelled stale. Recreating a logical session opens the
ledger in append mode and never clears prior evidence.

Compaction begins before context exhaustion at either 16K or 32K, as selected
in Settings. It retains instructions, task scope, exact current evidence,
shared coordination, the private warm checkpoint, recent tool results, and
response headroom. After compaction or hot-context eviction, an existing file
must be read again before it can be written. Summaries never replace current
files, Git state, logs, screenshots, or rerun test output.

Structured handoffs carry repository identity, completed work, files, leased
targets, checks, decisions, assumptions, blockers, unresolved risk, evidence to
rehydrate, remaining acceptance criteria, and a next action. The receiving role
validates the schema, repository revision, evidence references, and reservation
state before acknowledging the handoff.

## One-model residency and logical sessions

Planner, implementer, and reviewer are logical roles, not three simultaneously
loaded models. A coding job acquires one provider-neutral residency lease for
the configured coding model and reuses that exact resident weight allocation
through the sequential planner → implementer → reviewer workflow. Only one role
may generate at a time. The lease is reference counted and can be shared by
nested coding operations without reloading the model; the final release starts
the configured idle-unload timer.

Each role retains a private application checkpoint. Inactive roles default to
`checkpoint-reconstruct`: their live KV/session state is discarded at a role
boundary and reconstructed later from the validated checkpoint, current
repository evidence, and the bounded coordination handoff. A private hot or
warm transcript is never copied into another role. The only cross-role input is
the schema-validated handoff and shared task coordination described above.

The default coding context is 16K. A user may choose 32K, but the runtime first
reduces 32K to 16K under elevated memory pressure. If pressure remains unsafe,
it follows the configured policy: use a single reconstructable logical agent,
pause before loading weights, or offer the conservative 16K fallback. These
decisions occur before inference and are recorded in the durable job status.

Before a coding job starts, Kai Studio may request eviction of idle KaiLore
embedding and idle diagnostics/orchestration model residencies. Eviction is
strictly ownership and reference-count gated: active leases, pre-existing
user-managed runtimes, unsupported providers, and unrelated models are never
forcibly unloaded. Coding retrieval is burst-scoped and remains isolated from
KaiLore; it loads only for retrieval and is eligible for idle eviction after
the lease is released.

## Implementation-step and non-progress policy

Coding jobs use a counted implementation-step budget rather than a tool-call
limit. Repository inspection (`inspect_tree`, `read_file`, `search`, and
`inspect_screenshot`) is tracked separately and does not consume the budget.
Mutations and post-change verification commands count as implementation steps.

- At 40 counted steps the agent receives a non-blocking progress review note.
- At 80 the user sees a notification and private/warm memory is checkpointed.
- At 150 the loop pauses without failing and waits for an explicit decision:
  extend by exactly 50 steps or stop and preserve the checkout. Extensions may
  be repeated.

All actions, including inspection, feed an independent non-progress detector.
It stops repeated identical actions, identical failing checks without a new
hypothesis or change, and two-state cycles. Reading many distinct relevant
files is not itself a failure.

## Task-aware execution budget

Wall-clock handling is task-aware rather than a fixed kill switch. Default
initial budgets range from 15 minutes for focused fixes to 60 minutes for
greenfield or multi-agent integration. Settings can provide a bounded override.

Deterministic runtime evidence is authoritative: repository revisions, test
movement, completed subtasks, resolved blockers, resource state, handoffs, and
recent actions determine progress. A soft checkpoint and visible user notice
occur before the boundary. Recent measurable progress may earn automatic
five-minute continuations, capped at 20 minutes. At the boundary the job pauses
durably and offers +15 minutes, +30 minutes, stop for review, or cancel. Gemma
4 12B is used only for an ambiguous five-to-ten-minute progress window and
cannot override cancellation, resource guards, sandboxing, or deterministic
non-progress evidence.

The checkout, private and shared memory, counters, reservations, audit trail,
and final review state survive normal navigation. Active-job UI reports the
current role and phase, counted work versus inspection, context use,
repository revision, reservations, handoffs, blockers, elapsed time, extensions,
resource warnings, shared-model residency, private logical-session state, and
retrieval residency without exposing every low-level invocation.

## Diagnostics parsing and models

Diagnostics reports are parsed by the configurable `diagnostics.parser` role
(Gemma 4 12B by default). The parser only structures recommendations present in
the report. Recommendations are schema-validated, deduplicated, grouped by
severity, and require explicit human selection before implementation begins.
Malformed output fails safely and can be retried.

Model assignments resolve through the central registry and Settings roles.
Chat, diagnostics, diagnostics parser, progress assessor, security, coding,
orchestration, and review request capabilities rather than embedding model tags
in UI components. An unavailable assignment produces a visible error; no model
is silently substituted.

## Greenfield workspace

Greenfield work is isolated below the user-approved `KAI_GREENFIELD_ROOT`
(default `~/KaiStudioProjects`). The starter registry contains Next.js,
Electron + Next.js, and Node.js templates with declared commands and
capabilities. Path traversal, symlink escapes, protected locations, `.git`
writes, publishing, and deployment are blocked. Dependency installation remains
explicitly approval-gated. Successful work ends at a local review commit.

Repository content remains untrusted evidence, GitHub work retains security
preflight, diagnostics fast-track requires explicit human selection, and none
of these controls grant arbitrary shell, filesystem, web, secret, push, or
deployment authority.
