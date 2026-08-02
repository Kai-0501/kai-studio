# Coding-agent reliability and greenfield boundaries

Coding jobs use a counted implementation-step budget rather than a tool-call limit. Repository inspection (`inspect_tree`, `read_file`, `search`, and `inspect_screenshot`) is tracked separately and does not consume the budget. Mutations, dependency/configuration changes, and verification commands count as implementation steps.

At 40 counted steps the agent receives a non-blocking progress review note. At 80 the user sees a notification and warm memory is checkpointed. At 150 the loop pauses without failing and waits for an explicit decision: extend by exactly 50 steps or stop and preserve the checkout. Extensions may be repeated. Wall-clock, memory, sandbox, cancellation, and non-progress-cycle safeguards remain independent termination paths.

The coding loop uses hot/warm/cold working memory: recent turns stay hot, compact action/file/check summaries stay warm, and the lossless JSONL ledger stays cold on disk. Navigation does not cancel an active job; the active-job API exposes progress and extension controls.

Diagnostics reports are parsed by the configurable `diagnostics.parser` role (Gemma 4 12B by default). The parser only structures recommendations present in the report. Recommendations are schema-validated, deduplicated, grouped by severity, and require explicit human selection before a diagnostics implementation plan is handed to the coding agent.

Model assignments are resolved through `src/lib/models/config.ts` and Settings role assignments. A configured model must be available and satisfy its role capabilities; unavailable assignments produce an explicit error rather than silently switching models. New assignments include chat, diagnostics, diagnostics parser, security, coding, orchestration, and review.

Greenfield work is isolated below the approved `KAI_GREENFIELD_ROOT` (default `~/KaiStudioProjects`). The starter registry contains Next.js, Electron + Next.js, and Node.js templates. Path traversal, symlink escapes, `.git` writes, publishing, and deployment are blocked. Scaffold creation requires an explicit user action and creates only a local Git repository; dependency installation and remote operations remain separate approval-gated work.
