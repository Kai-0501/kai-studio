import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chunkCodeFile, CodingHybridIndex } from "@/lib/coding-retrieval";
import { createScopedHashEmbedder } from "@/lib/retrieval/embedding-provider";

test("coding chunks preserve symbol, test, and exact-path metadata", () => {
  const chunks = chunkCodeFile({
    repositoryId: "owner/repo",
    worktreeId: "test",
    revision: "head",
    relativePath: "src/math.test.ts",
    content: "import { add } from './math';\nexport function testAdd() { return add(1, 2); }",
  });
  assert.equal(chunks[0].classification, "test");
  assert.equal(chunks[0].symbolName, "testAdd");
  assert.equal(chunks[0].path, "src/math.test.ts");
});

test("coding retrieval remains repo-scoped and prefers exact lexical identifiers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kai-coding-retrieval-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "billing.ts"), "export function calculateInvoiceTotal() { return 42; }");
  await writeFile(path.join(root, "src", "other.ts"), "export function unrelated() { return 'hello'; }");
  const index = new CodingHybridIndex(root, "owner/only-this-repo", createScopedHashEmbedder({
    retrievalDomain: "coding", modelId: "local.memory-hash-embedding", modelRevision: "v1", dimensions: 64, normalization: "l2", metric: "cosine", chunkerVersion: "code-v1", schemaVersion: "1",
  }));
  await index.sync();
  const report = await index.retrieve("calculateInvoiceTotal src/billing.ts", { limit: 4 });
  assert.ok(report.selected.length > 0);
  assert.equal(report.selected[0].path, "src/billing.ts");
  assert.ok(report.selected[0].exactContent?.includes("calculateInvoiceTotal"));
});

test("coding retrieval does not return a stale file after the workspace changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kai-coding-stale-"));
  await writeFile(path.join(root, "entry.ts"), "export const stableToken = 'before';");
  const index = new CodingHybridIndex(root, "owner/stale-repo", createScopedHashEmbedder({
    retrievalDomain: "coding", modelId: "local.memory-hash-embedding", modelRevision: "v1", dimensions: 64, normalization: "l2", metric: "cosine", chunkerVersion: "code-v1", schemaVersion: "1",
  }));
  await index.sync();
  await writeFile(path.join(root, "entry.ts"), "export const stableToken = 'after';");
  const report = await index.retrieve("stableToken");
  assert.equal(report.selected.length, 0);
});
