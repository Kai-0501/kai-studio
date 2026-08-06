import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SqliteMemoryIndex } from "@/lib/memory/index-store";
import { HybridMemoryRetriever } from "@/lib/memory/retriever";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kai-memory-test-"));
  const lore = path.join(directory, "Memory");
  await mkdir(path.join(lore, "people"), { recursive: true });
  await writeFile(
    path.join(lore, "manifest.json"),
    JSON.stringify({ export_type: "full_snapshot", schema_version: "1.0" }),
  );
  await writeFile(
    path.join(lore, "people", "example.md"),
    `---
id: person-example
title: Example Person
domain: example
people: [Example Person]
tags: [example-context]
confidence: high
importance: 0.9
---
# Example Person
Example Person is a fixture record. Exact dates are unavailable.`,
  );
  await writeFile(
    path.join(lore, "people", "unrelated.md"),
    `---
id: unrelated-record
title: Unrelated Record
domain: example
people: [Unrelated Record]
tags: [unrelated]
confidence: medium
---
# Unrelated Record
Unrelated Record is a separate fixture record.`,
  );
  await writeFile(
    path.join(lore, "people", "old-angel.md"),
    `---
id: person-example-old
title: Old example note
domain: example
people: [Example Person]
status: superseded
---
# Old example
This old note should not be retrieved.`,
  );
  return { directory, lore };
}

test("incremental index skips unchanged files", async () => {
  const { directory, lore } = await fixture();
  const index = new SqliteMemoryIndex(lore, path.join(directory, "index.sqlite"));
  const first = await index.sync();
  const second = await index.sync();

  assert.equal(first.indexedFiles, 3);
  assert.equal(first.reindexedFiles, 3);
  assert.equal(second.reindexedFiles, 0);
  assert.equal(second.skippedFiles, 3);
  index.close();
});

test("generation status initializes a fresh memory index before inspection", async () => {
  const { directory, lore } = await fixture();
  const index = new SqliteMemoryIndex(lore, path.join(directory, "index.sqlite"));
  const retriever = new HybridMemoryRetriever(index);

  const generation = await retriever.generationStatus();

  assert.equal(generation?.retrieval_domain, "kailore");
  assert.equal(generation?.status, "active");
  index.close();
});

test("retrieves one person's records without injecting unrelated people", async () => {
  const { directory, lore } = await fixture();
  const index = new SqliteMemoryIndex(lore, path.join(directory, "index.sqlite"));
  const retriever = new HybridMemoryRetriever(index);
  const report = await retriever.retrieve("Tell me about Example Person", {
    topK: 1,
    candidateLimit: 10,
    maxCharacters: 2_000,
    maxPerDomain: 4,
    minimumScore: 0,
  });

  assert.deepEqual(
    report.retrieved.map((item) => item.record.id),
    ["person-example"],
  );
  assert.ok(report.totalCharacters < 2_000);
  assert.ok(
    report.retrieved[0].provenance.matchedEntities.includes("Example Person"),
  );
  index.close();
});

test("character budget excludes an otherwise relevant oversized record", async () => {
  const { directory, lore } = await fixture();
  const index = new SqliteMemoryIndex(lore, path.join(directory, "index.sqlite"));
  const retriever = new HybridMemoryRetriever(index);
  const report = await retriever.retrieve("Example Person", {
    topK: 5,
    candidateLimit: 10,
    maxCharacters: 20,
    maxPerDomain: 5,
    minimumScore: 0,
  });
  assert.equal(report.retrieved.length, 0);
  assert.equal(report.totalCharacters, 0);
  index.close();
});
