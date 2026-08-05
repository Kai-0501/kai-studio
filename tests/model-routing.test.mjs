import test from "node:test";
import assert from "node:assert/strict";
import { modelRegistry, roleRoutes } from "../src/lib/models/config.ts";
import { modelSatisfiesRoute } from "../src/lib/models/runtime.ts";

test("secure coding roles route to separate configured models", () => {
  const coder = modelRegistry.get(roleRoutes["coder.primary"].primary);
  const preflight = modelRegistry.get(roleRoutes["security.preflight"].primary);
  const postflight = modelRegistry.get(roleRoutes["security.postflight"].primary);
  assert.equal(coder?.providerModel, "qwen3.6:27b-mtp-q4_K_M");
  assert.equal(preflight?.providerModel, "gpt-oss-safeguard:20b");
  assert.equal(postflight?.providerModel, "gemma4:31b-mlx");
  assert.notEqual(postflight?.id, preflight?.id);
  assert.notEqual(coder?.id, preflight?.id);
});

test("capability validation rejects models lacking verified tool support", () => {
  const security = modelRegistry.get("local.gemma4-31b-security");
  const coder = modelRegistry.get("local.qwen3.6-27b-coder");
  assert.ok(security && coder);
  assert.equal(modelSatisfiesRoute(security, ["coding", "tools", "structured-output"], true), false);
  assert.equal(modelSatisfiesRoute(coder, ["coding", "tools", "structured-output"], true), true);
});

test("local-only routes reject cloud models", () => {
  const cloud = modelRegistry.get("cloud.gemini-orchestrator");
  assert.ok(cloud);
  assert.equal(modelSatisfiesRoute({ ...cloud, enabled: true }, ["orchestration"], true), false);
});

test("bounded image roles use the central registry and capability routes", () => {
  const planner = modelRegistry.get(roleRoutes["image.planner"].primary);
  const generator = modelRegistry.get(roleRoutes["image.generator"].primary);
  const reviewer = modelRegistry.get(roleRoutes["vision.reviewer"].primary);
  assert.ok(planner && generator && reviewer);
  assert.equal(modelSatisfiesRoute(generator, ["image-generation"], true), true);
  assert.equal(modelSatisfiesRoute(planner, ["chat", "structured-output"], true), true);
  assert.equal(modelSatisfiesRoute(reviewer, ["vision", "structured-output"], true), true);
});
