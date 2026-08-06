import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composerSource = await readFile(new URL("../src/components/studio-chat.tsx", import.meta.url), "utf8");

test("chat composer keeps secondary controls shrinkable and wrap-capable", () => {
  assert.match(composerSource, /flex flex-wrap items-center justify-between gap-2 px-1 pb-1/);
  assert.match(composerSource, /flex min-w-0 flex-1 flex-wrap items-center gap-1/);
  assert.match(composerSource, /sm:max-w-\[min\(18rem,40vw\)\]/);
  assert.match(composerSource, /title=\{`\$\{selectedModel\.label\} · \$\{selectedModel\.detail\}`\}/);
  assert.match(composerSource, /className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full/);
});
