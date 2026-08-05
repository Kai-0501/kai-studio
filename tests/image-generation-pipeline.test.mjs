import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVisualIntent } from "../src/lib/image-generation/pipeline.ts";
import { buildOllamaImageRequest, parseOllamaImageResponse } from "../src/lib/models/ollama-provider.ts";

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

test("long constrained prompts use one complete JSON request envelope", () => {
  const prompt = `Japandi bedroom — 4.2m × 5.4m. A sunken floor for the bed, plus a built-in wardrobe with glass doors.\nDo not substitute a platform bed, opaque wardrobe, loft bed, or text overlay. Keep the room calm, natural, and minimal. Quotes: "quiet luxury"; apostrophe: Kai's.`;
  const request = buildOllamaImageRequest({ providerModel: "x/z-image-turbo" }, { prompt, width: 1024, height: 576 });
  const serialised = JSON.stringify(request);
  assert.equal(JSON.parse(serialised).prompt, prompt);
  assert.equal(JSON.parse(serialised).size, "1024x576");
  assert.equal(JSON.parse(serialised).response_format, "b64_json");
});

test("image adapter parses OpenAI-compatible base64 envelopes and rejects incomplete bodies safely", async () => {
  const image = "aW1hZ2UtYnl0ZXM=";
  assert.equal(await parseOllamaImageResponse(new Response(JSON.stringify({ data: [{ b64_json: image }] }), { status: 200, headers: { "content-type": "application/json" } })), image);
  await assert.rejects(() => parseOllamaImageResponse(new Response('{"data":[', { status: 200, headers: { "content-type": "application/json" } })), /incomplete JSON response/);
  await assert.rejects(() => parseOllamaImageResponse(new Response("", { status: 200, headers: { "content-type": "application/json" } })), /empty response/);
});
