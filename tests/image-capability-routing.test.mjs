import assert from "node:assert/strict";
import test from "node:test";
import { mapOllamaTagModels } from "../src/app/api/system/status/route.ts";

test("startup scan keeps fresh Ollama capability metadata for image and text models", () => {
  const models = mapOllamaTagModels({ models: [
    { name: "x/z-image-turbo:latest", size: 1, modified_at: "2026-08-06T00:00:00Z", capabilities: ["image"] },
    { name: "gemma4:26b-mlx", size: 1, modified_at: "2026-08-06T00:00:00Z", capabilities: ["completion"] },
  ] });
  assert.deepEqual(models.find((model) => model.name.startsWith("x/z-image"))?.capabilities, ["image"]);
  assert.deepEqual(models.find((model) => model.name.startsWith("gemma"))?.capabilities, ["completion"]);
});
