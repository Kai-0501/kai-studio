import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVisualIntent } from "../src/lib/image-generation/pipeline.ts";
import { buildOllamaImageRequest, buildOllamaNativeImageRequest, describeOllamaImageRequest, ollamaProvider, parseOllamaImageResponse, validateOllamaImageRuntime } from "../src/lib/models/ollama-provider.ts";

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

test("native Ollama image fallback uses the documented generate envelope", () => {
  const prompt = "A sunken Japandi bedroom with a smoked-glass wardrobe";
  const request = buildOllamaNativeImageRequest({ providerModel: "x/z-image-turbo" }, { prompt, width: 1024, height: 576 });
  assert.deepEqual(request, {
    model: "x/z-image-turbo",
    prompt,
    stream: false,
    width: 1024,
    height: 576,
  });
  assert.deepEqual(describeOllamaImageRequest(request), {
    requestBodyBytes: Buffer.byteLength(JSON.stringify(request)),
    requestFields: "height,model,prompt,stream,width",
    promptLength: prompt.length,
    negativePromptLength: 0,
    dimensions: "1024x576",
    providerModel: "x/z-image-turbo",
    optionalParameters: "none",
  });
});

test("image generation falls back exactly once to Ollama native generate after the OpenAI route returns 404", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) return new Response("404 page not found", { status: 404, headers: { "content-type": "text/plain" } });
    return new Response(JSON.stringify({ image: png, done: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await ollamaProvider.generateImage(
      { id: "z-image", providerModel: "x/z-image-turbo" },
      { prompt: "A sunken Japandi bedroom", width: 1024, height: 576 },
    );
    assert.equal(result.imageBase64, png);
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/v1/images/generations", "/api/generate"]);
    assert.deepEqual(calls[1].body, {
      model: "x/z-image-turbo",
      prompt: "A sunken Japandi bedroom",
      stream: false,
      width: 1024,
      height: 576,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

test("image adapter parses OpenAI-compatible base64 envelopes and rejects incomplete bodies safely", async () => {
  const image = png;
  assert.equal(await parseOllamaImageResponse(new Response(JSON.stringify({ data: [{ b64_json: image }] }), { status: 200, headers: { "content-type": "application/json" } })), image);
  assert.equal(await parseOllamaImageResponse(new Response(JSON.stringify({ image, done: true }), { status: 200, headers: { "content-type": "application/json" } })), image);
  assert.equal(await parseOllamaImageResponse(new Response(JSON.stringify({ data: [{ url: `data:image/png;base64,${image}` }] }), { status: 200, headers: { "content-type": "application/json" } })), image);
  await assert.rejects(() => parseOllamaImageResponse(new Response(JSON.stringify({ data: [{ url: "https://example.test/image.png" }] }), { status: 200, headers: { "content-type": "application/json" } })), /returned an image URL/);
  await assert.rejects(() => parseOllamaImageResponse(new Response('{"data":[', { status: 200, headers: { "content-type": "application/json" } })), /incomplete JSON response/);
  await assert.rejects(() => parseOllamaImageResponse(new Response("", { status: 200, headers: { "content-type": "application/json" } })), /empty response/);
  await assert.rejects(
    async () => parseOllamaImageResponse(new Response(JSON.stringify({ error: "unsupported parameter: seed" }), { status: 400, headers: { "content-type": "application/json" } })),
    (error) => error?.details?.responseError === "unsupported parameter: seed",
  );
});

test("image adapter decodes Ollama NDJSON line by line and retains the final image", async () => {
  const body = [
    JSON.stringify({ object: "image.progress", model: "x/z-image-turbo", progress: 32 }),
    "",
    JSON.stringify({ object: "image.chunk", created: 123, data: [{ index: 0, object: "image.chunk", progress: 100, b64_json: png }] }),
    JSON.stringify({ done: true }),
    "",
  ].join("\n");
  const response = new Response(body, { status: 200, headers: { "content-type": "Application/X-NDJSON; charset=utf-8" } });
  assert.equal(await parseOllamaImageResponse(response), png);
  assert.equal(response.bodyUsed, true);
});

test("image adapter supports metadata and a trailing malformed NDJSON line after a verified image", async () => {
  const body = `${JSON.stringify({ model: "x/z-image-turbo", created: 123 })}\n${JSON.stringify({ data: [{ b64_json: png }] })}\nnot-json`;
  assert.equal(await parseOllamaImageResponse(new Response(body, { status: 200, headers: { "content-type": "application/ndjson" } })), png);
});

test("image adapter reports precise NDJSON terminal, malformed, and missing-image failures", async () => {
  await assert.rejects(
    () => parseOllamaImageResponse(new Response(`${JSON.stringify({ error: "model exhausted" })}\n`, { status: 200, headers: { "content-type": "application/x-ndjson" } })),
    (error) => error?.category === "provider-declared" && error?.details?.terminalEventType === "terminal-error",
  );
  await assert.rejects(
    () => parseOllamaImageResponse(new Response(`not-json\n${JSON.stringify({ data: [{ b64_json: png }] })}`, { status: 200, headers: { "content-type": "application/x-ndjson" } })),
    (error) => error?.category === "response-decode" && error?.details?.malformedLineNumber === 1,
  );
  await assert.rejects(
    () => parseOllamaImageResponse(new Response(`${JSON.stringify({ object: "image.progress", progress: 50 })}\n${JSON.stringify({ done: true })}`, { status: 200, headers: { "content-type": "application/x-ndjson" } })),
    (error) => error?.category === "missing-image" && error?.details?.imageEventFound === false,
  );
});

test("image adapter validates binary responses and handles a near-production sized NDJSON payload", async () => {
  const binary = Buffer.from(png, "base64");
  assert.equal(await parseOllamaImageResponse(new Response(binary, { status: 200, headers: { "content-type": "image/png" } })), png);
  const large = Buffer.concat([binary, Buffer.alloc(660_000)]).toString("base64");
  const body = `${JSON.stringify({ object: "image.progress", progress: 99 })}\n${JSON.stringify({ data: [{ b64_json: large }] })}\n`;
  assert.ok(Buffer.byteLength(body) > 800_000);
  assert.equal(await parseOllamaImageResponse(new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } })), large);
});

test("Ollama image validation accepts an image model without probing an unsupported OPTIONS route", async () => {
  const model = { providerModel: "x/z-image-turbo:latest" };
  const requests = [];
  await validateOllamaImageRuntime(model, undefined, async (url, init) => {
    requests.push({ url: String(url), method: init?.method });
    return new Response(JSON.stringify({ capabilities: ["image"] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.deepEqual(requests.map((entry) => entry.method), ["POST"]);
  assert.match(requests[0].url, /\/api\/show$/);
});

test("Ollama image validation preserves aliases and never caches stale capability metadata", async () => {
  const seenModels = [];
  for (const providerModel of ["x/z-image-turbo", "x/z-image-turbo:latest"]) {
    await validateOllamaImageRuntime({ providerModel }, undefined, async (_url, init) => {
      seenModels.push(JSON.parse(init.body).model);
      return new Response(JSON.stringify({ capabilities: ["image"] }), { status: 200, headers: { "content-type": "application/json" } });
    });
  }
  assert.deepEqual(seenModels, ["x/z-image-turbo", "x/z-image-turbo:latest"]);

  let validationCount = 0;
  await validateOllamaImageRuntime({ providerModel: "x/z-image-turbo:latest" }, undefined, async () => {
    validationCount += 1;
    return new Response(JSON.stringify({ capabilities: validationCount === 1 ? ["image"] : ["completion"] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  await assert.rejects(
    () => validateOllamaImageRuntime({ providerModel: "x/z-image-turbo:latest" }, undefined, async () => {
      validationCount += 1;
      return new Response(JSON.stringify({ capabilities: ["completion"] }), { status: 200, headers: { "content-type": "application/json" } });
    }),
    /does not expose image-generation capability/,
  );
  assert.equal(validationCount, 2);
});
