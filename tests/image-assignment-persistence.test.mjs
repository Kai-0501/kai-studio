import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("persisted image assignments survive restart semantics and can switch model selections", async () => {
  process.env.KAI_STUDIO_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "kai-image-settings-"));
  const { readSettings, writeSettings } = await import("../src/lib/settings-store.ts");
  const initial = await readSettings();

  await writeSettings({ modelAssignments: { ...initial.modelAssignments, image: "x/z-image-turbo:latest" } });
  assert.equal((await readSettings()).modelAssignments.image, "x/z-image-turbo:latest");

  const imageAssignment = await readSettings();
  await writeSettings({ modelAssignments: { ...imageAssignment.modelAssignments, image: "x/z-image-turbo:alternate" } });
  assert.equal((await readSettings()).modelAssignments.image, "x/z-image-turbo:alternate");

  const textAssignment = await readSettings();
  await writeSettings({ modelAssignments: { ...textAssignment.modelAssignments, image: "gemma4:26b-mlx" } });
  assert.equal((await readSettings()).modelAssignments.image, "gemma4:26b-mlx");
});
