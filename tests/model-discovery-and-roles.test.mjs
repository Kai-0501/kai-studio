import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clearLocalModelDiscoveryCache, discoverLocalModels } from "../src/lib/local-model-discovery.ts";
import { defaultModelAssignments, modelRoleDescriptions } from "../src/lib/models/roles.ts";

test("role metadata covers every configurable role without UI-local prose", () => {
  for (const role of Object.keys(defaultModelAssignments)) {
    const item = modelRoleDescriptions.find((candidate) => candidate.key === role);
    assert.ok(item, `missing description for ${role}`);
    assert.ok(item.description.length > 20);
  }
  assert.ok(modelRoleDescriptions.find((role) => role.key === "future"));
});

test("generic MLX discovery recognises a user-managed model directory as a candidate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kai-models-"));
  const model = path.join(root, "Any-Qwen-27B-mlx-2bit");
  await mkdir(model);
  await writeFile(path.join(model, "config.json"), JSON.stringify({ model_type: "qwen3_moe", architectures: ["Qwen3MoeForCausalLM"] }));
  await writeFile(path.join(model, "model.safetensors"), "fixture");
  clearLocalModelDiscoveryCache();
  const models = await discoverLocalModels({ extraRoots: [root] });
  const canonicalModel = await realpath(model);
  const found = models.find((candidate) => candidate.canonicalPath === canonicalModel);
  assert.equal(found?.runtime, "mlx");
  assert.equal(found?.status, "candidate");
  assert.equal(found?.ownership, "manual");
  assert.match(found?.name ?? "", /^local:/);
});
