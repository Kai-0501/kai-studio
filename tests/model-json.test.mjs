import assert from "node:assert/strict";
import test from "node:test";
import { parseModelJson } from "@/lib/model-json";

test("parses plain and fenced model JSON", () => {
  assert.deepEqual(parseModelJson('{"safe":true}'), { safe: true });
  assert.deepEqual(parseModelJson('```json\n{"safe":true}\n```'), { safe: true });
});

test("rejects model output without a JSON object", () => {
  assert.throws(() => parseModelJson("I cannot comply."), /JSON object/);
});
