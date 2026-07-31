# Kai Studio

**A private, local-first AI workspace built for Apple Silicon.**

Kai Studio began as a reusable prompt library and evolved into a full desktop
workspace for local AI: persistent chat, purpose-built workflows, private
long-term memory, speech-to-text, image generation, and local performance
tracking.

Everything runs on the user's Mac. Conversations, workflow inputs, generated
outputs, and memory stay local.

## Highlights

- **Desktop chat** with selectable local Gemma models
- **Temporary chats** that use memory without adding history
- **Tiered KaiLore memory** with human-editable Markdown records and local
  hybrid retrieval
- **Local dictation** using Parakeet TDT 0.6B v2
- **Local image generation** through Z-Image Turbo
- **Owned-repository GitHub vault** that syncs only repositories belonging to
  the authenticated account, excludes forks, and hands coding work to the
  local Gemma 4 31B model
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

## Architecture

```text
Electron desktop shell
        │
        ▼
Next.js application + local API routes
        │
        ├── Ollama → Gemma chat and reasoning models
        ├── Ollama → Z-Image Turbo
        ├── FluidAudio → Parakeet speech-to-text
        ├── GitHub CLI → owned repository metadata and README cache
        └── Local filesystem + SQLite → history, settings and KaiLore memory
```

Kai Studio deliberately keeps model plumbing behind the interface. The user
chooses what they want to do; the application handles prompt construction,
local routing, persistence, and retrieval.

For the memory design, see
[docs/memory-architecture.md](docs/memory-architecture.md).

## Technology

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Electron
- Ollama
- Node.js SQLite
- FluidAudio / Parakeet

## Development

Requirements:

- macOS on Apple Silicon
- Node.js and npm
- Ollama
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

- KaiLore memory records
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
