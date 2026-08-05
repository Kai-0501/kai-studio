import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVisualIntent } from "../src/lib/image-generation/pipeline.ts";
import { buildOllamaImageRequest, describeOllamaImageRequest, parseOllamaImageResponse, validateOllamaImageRuntime } from "../src/lib/models/ollama-provider.ts";

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
  assert.equal(JSON.parse(serialised).n, 1);
  assert.equal(JSON.parse(serialised).response_format, "b64_json");
  assert.equal("seed" in JSON.parse(serialised), false);
  assert.deepEqual(describeOllamaImageRequest(JSON.parse(serialised)), {
    requestBodyBytes: Buffer.byteLength(serialised),
    requestFields: "model,n,prompt,response_format,size",
    promptLength: prompt.length,
    negativePromptLength: 0,
    dimensions: "1024x576",
    providerModel: "x/z-image-turbo",
    optionalParameters: "none",
  });
});

test("image adapter parses OpenAI-compatible base64 envelopes and rejects incomplete bodies safely", async () => {
  const image = "aW1hZ2UtYnl0ZXM=";
  assert.equal(await parseOllamaImageResponse(new Response(JSON.stringify({ data: [{ b64_json: image }] }), { status: 200, headers: { "content-type": "application/json" } })), image);
  assert.equal(await parseOllamaImageResponse(new Response(JSON.stringify({ data: [{ url: `data:image/png;base64,${image}` }] }), { status: 200, headers: { "content-type": "application/json" } })), image);
  await assert.rejects(() => parseOllamaImageResponse(new Response(JSON.stringify({ data: [{ url: "https://example.test/image.png" }] }), { status: 200, headers: { "content-type": "application/json" } })), /returned an image URL/);
  await assert.rejects(() => parseOllamaImageResponse(new Response('{"data":[', { status: 200, headers: { "content-type": "application/json" } })), /incomplete JSON response/);
  await assert.rejects(() => parseOllamaImageResponse(new Response("", { status: 200, headers: { "content-type": "application/json" } })), /empty response/);
  await assert.rejects(
    async () => parseOllamaImageResponse(new Response(JSON.stringify({ error: "unsupported parameter: seed" }), { status: 400, headers: { "content-type": "application/json" } })),
    (error) => error?.details?.responseError === "unsupported parameter: seed",
  );
});

test("Ollama image validation requires both model capability and the native image route", async () => {
  const model = { providerModel: "x/z-image-turbo:latest" };
  const requests = [];
  await validateOllamaImageRuntime(model, undefined, async (url, init) => {
    requests.push({ url: String(url), method: init?.method });
    if (init?.method === "POST") return new Response(JSON.stringify({ capabilities: ["image"] }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  });
  assert.deepEqual(requests.map((entry) => entry.method), ["POST", "OPTIONS"]);
  await assert.rejects(
    () => validateOllamaImageRuntime(model, undefined, async () => new Response(JSON.stringify({ capabilities: ["completion"] }), { status: 200, headers: { "content-type": "application/json" } })),
    /does not expose image-generation capability/,
  );
  await assert.rejects(
    () => validateOllamaImageRuntime(model, undefined, async (_url, init) => init?.method === "POST"
      ? new Response(JSON.stringify({ capabilities: ["image"] }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(null, { status: 404 })),
    /does not expose image generation/,
  );
});
