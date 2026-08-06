# Kai Studio

**A private, local-first AI workspace built for Apple Silicon.**

Kai Studio began as a reusable prompt library and evolved into a full desktop
workspace for local AI: persistent chat, purpose-built workflows, private
long-term memory, speech-to-text, image generation, and local performance
tracking.

Everything runs on the user's Mac. Conversations, workflow inputs, generated
outputs, and memory stay local.

## Highlights

- **Desktop chat** with automatically discovered local models from Ollama and
  Hugging Face-compatible runtimes
- **Temporary chats** with recent-turn continuity only: no history, archive,
  checkpoint, conversation index, or KaiLore retrieval
- **Tiered local memory** with human-editable Markdown records and local
  hybrid retrieval
- **Retrieval-aware conversation continuity** with a configurable Context
  Router, bounded recent turns, exact older-message rehydration, branch-safe
  archives, and explicit per-message source controls
- **Local dictation** using Parakeet TDT 0.6B v2
- **Bounded local image generation** through a model-configurable pipeline:
  structured visual intent, deterministic validation, generation, vision review,
  and at most two corrective retries—never a raw prompt bypass
- **Owned-repository GitHub vault** that syncs only repositories belonging to
  the authenticated account and excludes forks
- **Two-stage secure builds**: a bounded Gemma security review runs first,
  followed by a tool-using Qwen coding agent only after the repository passes
  review
- **GPT-OSS Safeguard preflight** with OpenAI Harmony-compatible runtime
  routing, fail-closed structured verdicts, and Gemma fallback
- **Kai Agent** for direct user-to-plan-to-approved-coding handoffs
- **Greenfield Workspace** with bounded templates and filesystem protections
- **Memory Phase 2A** with pluggable local dense embeddings and sparse fallback
- **Persistent background build sessions** that survive navigation and keep
  running while Kai Studio is in the background
- **Configurable model assignments** for chat, workflows, coding, security,
  vision, and diagnostics without changing application code
- **Read-only diagnostics agent** that audits Kai Studio, saves its report to
  history, and can turn selected findings into implementation-ready plans
- **Searchable workflow library** with:
  - Meeting Intelligence
  - Editorial Intelligence
  - Account Intelligence
  - General Intelligence
- **Persistent conversation history** with automatic titles, follow-ups,
  deletion controls, regeneration, and model switching
- **Markdown rendering** for headings, tables, lists, and formatted output
- **PDF extraction** for editorial and account-research workflows
- **Generation telemetry**, including tokens per second by conversation and
  model
- **Federated hybrid coding memory** with isolated planner, implementer, and
  reviewer sessions, versioned shared coordination, leased write reservations,
  proactive 16K/32K compaction, private retrieval, and a shared auditable cold ledger
- **Progress-aware coding budgets** with deterministic progress checks,
  non-blocking checkpoints, durable pause/resume, bounded automatic
  continuations, and explicit user extensions

## Architecture

```text
Electron desktop shell
        │
        ▼
Next.js application + local API routes
        │
        ├── Model-agnostic runtime → role and capability routing
        │      ├── Ollama
        │      ├── managed llama.cpp / Hugging Face models
        │      ├── OpenAI-compatible endpoints
        │      └── Gemini-compatible cloud orchestration
        ├── Bounded image pipeline → configured local image provider + vision review
        ├── FluidAudio → Parakeet speech-to-text
        ├── GitHub CLI → owned repository metadata and README cache
        └── Local filesystem + SQLite → history, settings, telemetry and memory
```

Kai Studio deliberately keeps model plumbing behind the interface. The user
chooses what they want to do; the application handles prompt construction,
local routing, persistence, and retrieval.

For the memory design, see
[docs/memory-architecture.md](docs/memory-architecture.md).

For retrieval-domain isolation, context routing, and conversation archives, see
[docs/retrieval-architecture.md](docs/retrieval-architecture.md).

For secure repository automation and bounded coding context, see
[docs/secure-build-architecture.md](docs/secure-build-architecture.md).

For model discovery and role routing, see
[docs/model-runtime.md](docs/model-runtime.md).

For the bounded image-generation policy and provider-neutral flow, see
[docs/image-generation-architecture.md](docs/image-generation-architecture.md).

For the GPT-OSS Safeguard policy and official Harmony references, see
[docs/security/gpt-oss-safeguard-policy.md](docs/security/gpt-oss-safeguard-policy.md).

For Phase 2A memory and bounded coding-memory design, see
[docs/memory-phase-2a.md](docs/memory-phase-2a.md).

## Technology

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Electron
- Ollama, Kai Studio's managed llama.cpp runtime, or another configured model
  provider
- Node.js SQLite
- FluidAudio / Parakeet

## Development

Requirements:

- macOS on Apple Silicon
- Node.js and npm
- Ollama and llama.cpp (managed automatically by the desktop app)
- Compatible local models matching the model identifiers configured in the
  application

Install dependencies and start the web development build:

```bash
npm install
npm run dev
```

Run verification:

```bash
npm run lint
npm test
npm run build
```

Build the macOS desktop application:

```bash
npm run desktop:build
```

The Parakeet helper binary and model weights are intentionally excluded from
this source repository. A local desktop build must provide the FluidAudio CLI
at `vendor/audio/fluidaudiocli`; model weights are stored outside the
repository in Kai Studio's application-support directory.

## Privacy

This repository contains application source only. It does **not** include:

- local memory records
- conversation history
- generated outputs
- local model weights
- API keys or environment files
- packaged macOS applications

## Status

Kai Studio is an active personal project and portfolio build. It is optimized
for one local Apple-Silicon setup rather than distributed as a turnkey consumer
product—yet.

## License

No license has been granted yet. All rights reserved unless a license is added
in a future release.
