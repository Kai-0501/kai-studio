# Kai Studio hot-and-cold memory

## Scope

This is application-layer long-term memory. It is inspired by hot/cold tiering,
but it does not implement or claim compatibility with oMLX and does not page a
model's KV cache.

The system keeps distinct resources separate:

| Resource | Location | Lifetime | Purpose |
| --- | --- | --- | --- |
| Recent conversation | Active model context | Current chat | Conversational continuity |
| Conversation checkpoint | Local run store | Saved conversation lifetime | Structured continuity across long chats |
| Conversation archive | Dedicated SQLite index | Saved conversation lifetime | Exact retrieval from older turns in one active branch |
| Session working memory | Bounded RAM cache | Up to one hour | Reuse selected long-term records for follow-ups |
| Hot retrieval cache | Bounded RAM cache | Configurable TTL | Avoid repeated parsing/ranking work |
| Memory Markdown | SSD | Until the user edits it | Canonical human-editable long-term memory |
| SQLite index | SSD | Rebuilt incrementally | Search metadata, FTS index, sparse vectors, and access data |
| Model KV cache | Model backend | Backend-defined | Out of scope for Phase 1 |

The complete corpus is never assembled into a prompt. SQLite returns a bounded
candidate set and the retriever applies a second ranking and budget pass before
prompt construction.

## Conversation memory and KaiLore are different systems

Conversation memory records what was said in one saved chat. KaiLore records
durable, user-managed facts and preferences. They have separate model roles,
embedding assignments, SQLite generations, retention rules, provenance, and
deletion paths. The Context Router may select either or both, but a hybrid
request remains bounded by one combined token budget and the UI can disclose
which sources contributed.

Conversation evidence is inserted as explicitly untrusted context. Current user
instructions outrank it. Stable source IDs and hashes allow exact rehydration;
edits, deletions, and branch changes invalidate stale chunks rather than letting
old content leak into a response.

Temporary chats are an isolation boundary, not merely a hidden-history option.
They use only the current request and bounded recent turns. They do not save a
run, create a checkpoint, write an archive/index entry, or retrieve KaiLore.

## Phase 1 data flow

1. A chat sends the latest user message and a few compact recent turns.
2. The indexer scans Markdown files beneath the configured memory root.
3. SHA-256 hashes prevent unchanged files from being parsed and indexed again.
4. SQLite FTS selects a wider candidate set without reading the corpus into RAM.
5. Hybrid ranking combines FTS rank, normalized sparse-vector similarity,
   exact entity/tag matches, explicit importance, recency, and prior access.
6. Domain diversity, minimum score, record count, and character budgets reduce
   candidates to the final context set.
7. Selected records enter bounded RAM caches and a small per-session working set.
8. The prompt builder places JSON-escaped record content in a dedicated,
   explicitly untrusted memory-evidence block.

Phase 1 deliberately uses normalized sparse term vectors stored in SQLite. They
are deterministic, dependency-free, and offline, but they are not neural
embeddings. A local embedding provider is a Phase 2 interface addition; Kai
Studio currently has no installed embedding model to rely upon.

## MemoryRecord Markdown schema

Markdown with YAML front matter is canonical. The parser intentionally accepts
a conservative subset: scalar values, inline arrays, and dash lists.

```markdown
---
id: person-example-001
title: Example Person
domain: personal
category: profile
people: [Example Person]
entities: [example-context]
tags: [example]
created_at: 2026-07-30
updated_at: 2026-07-30
confidence: high
status: active
source: chatgpt-memory-export
relationships: [met_at:secondary-school]
importance: 0.9
operation: upsert
supersedes: []
unknowns: [exact dates unavailable]
valid_from: example-context
---
# Example Person

Known content goes here. Unknown details remain explicitly unknown.
```

Supported statuses are `active`, `uncertain`, `superseded`, `deprecated`, and
`forgotten`. Supported operations are `upsert`, `supersede`, `deprecate`,
`delete`, and `forget`.

`delete` and `forget` records become non-retrievable tombstones. The indexer
does not erase their SQLite rows or source files. File disappearance also does
not silently delete indexed canon. A future reviewed compaction command can
perform destructive removal with an audit trail.

When a retrieved record explicitly lists IDs in `supersedes`, those older IDs
are removed from the same retrieval result. A record merely having a later date
does not silently override another record.

## Memory corpus ingestion

Place the export in the application data directory:

```text
Memory/
├── manifest.json
├── README.md
├── profile/
├── timeline/
├── people/
├── church/
├── career/
├── ai/
├── health/
├── finance/
├── interests/
└── memories/
```

In a packaged macOS build, the default data directory is Kai Studio's Electron
`userData/data` directory. In development it is `.promptdeck/`. Override either
location without code changes:

```text
KAI_STUDIO_DATA_DIR=/path/to/data
KAI_STUDIO_KAILORE_DIR=/path/to/Memory
KAI_STUDIO_MEMORY_INDEX=/path/to/memory-index.sqlite
```

The scanner accepts nested Markdown alongside `manifest.json`. The manifest is
reserved for export lineage and compatibility checks; Phase 1 does not mutate
it. Full snapshots and delta exports both work when every delta record carries
an explicit `operation`. Copying a new snapshot does not cause absent records
to be deleted.

Enable **Tiered local memory** under Settings after placing the corpus. Until
then, existing chat and weekly-memory behavior remains unchanged.

## Configuration

All limits have conservative defaults:

```text
KAI_STUDIO_MEMORY_TOP_K=6
KAI_STUDIO_MEMORY_CANDIDATES=30
KAI_STUDIO_MEMORY_MAX_CHARACTERS=12000
KAI_STUDIO_MEMORY_MAX_PER_DOMAIN=3
KAI_STUDIO_MEMORY_MINIMUM_SCORE=0.08
KAI_STUDIO_MEMORY_CACHE_ENTRIES=64
KAI_STUDIO_MEMORY_CACHE_BYTES=2000000
KAI_STUDIO_MEMORY_CACHE_TTL_MS=900000
```

Diagnostics are off by default. When enabled in Settings,
`GET /api/memory/debug?sessionId=<chat-session-id>` reports selected records,
scores, matched entities/tags, index activity, budget use, and cache metrics.
It is local developer telemetry and does not expose chain-of-thought.

## Security and uncertainty rules

- Memory content is reference evidence, never an instruction source.
- Memory is JSON-escaped inside a delimited system section.
- Current user text and current conversation take priority.
- Confidence, uncertainty, validity, and status are preserved in the prompt.
- Missing fields remain absent; the parser and retriever do not infer lore.
- Permanent memory candidate creation is a non-writing stub until a human
  approval workflow exists.

## Phase 2 roadmap

1. Add a pluggable local embedding provider and persisted dense vectors, with
   streaming/partitioned nearest-neighbor search that does not load all vectors.
2. Add a cross-encoder or compact local reranker.
3. Add entity-graph traversal with strict hop and context budgets.
4. Validate manifest schema and export lineage before applying deltas.
5. Add reviewed memory-candidate extraction and explicit accept/edit/reject UI.
6. Add audited consolidation and summarization of overlapping records.
7. Add richer inspector UI for retrieval explanations and cache eviction.
8. Integrate cold KV-cache support only if a model backend exposes a stable API;
   keep it separate from semantic long-term memory.
