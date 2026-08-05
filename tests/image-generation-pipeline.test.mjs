import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVisualIntent } from "../src/lib/image-generation/pipeline.ts";

test("image planner output preserves explicit mandatory requirements", () => {
  const intent = normalizeVisualIntent({
    purpose: "Bedroom concept", subject: "Japandi bedroom", architectureSpatial: "Sunken bed floor and glass wardrobe", aspectRatio: "16:9",
    requirements: [
      { id: "sunken-bed", category: "architecture", description: "A clearly visible sunken floor for the bed", importance: "mandatory", mustShow: true, evaluationMethod: "visual", confidence: 0.95 },
      { id: "glass-wardrobe", category: "architecture", description: "A built-in wardrobe with glass doors", importance: "mandatory", mustShow: true, evaluationMethod: "visual", confidence: 0.95 },
    ], forbiddenElements: ["text overlays"], ambiguities: [],
  }, "Create a japandi bedroom with a sunken floor bed and glass wardrobe.");
  assert.equal(intent?.subject, "Japandi bedroom");
  assert.equal(intent?.requirements.filter((item) => item.importance === "mandatory").length, 2);
  assert.equal(intent?.forbiddenElements[0], "text overlays");
});

test("invalid visual brief fails before provider generation", () => {
  const intent = normalizeVisualIntent({ subject: "A room", requirements: [] }, "Make a room");
  assert.equal(intent, null);
});
