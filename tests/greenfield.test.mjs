import test from "node:test";
import assert from "node:assert/strict";
import { greenfieldTemplates, getGreenfieldTemplate } from "../src/lib/greenfield-templates.ts";

test("greenfield registry exposes the bounded starter templates", () => {
  assert.equal(greenfieldTemplates.length, 3);
  assert.equal(getGreenfieldTemplate("nextjs")?.commands.test, "npm test");
  assert.equal(getGreenfieldTemplate("unknown"), null);
});
