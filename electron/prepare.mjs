import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

await mkdir(path.join(standalone, ".next"), { recursive: true });
await rm(path.join(standalone, ".next", "static"), {
  recursive: true,
  force: true,
});
await cp(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static"),
  { recursive: true },
);

await rm(path.join(standalone, "public"), { recursive: true, force: true });
await cp(path.join(root, "public"), path.join(standalone, "public"), {
  recursive: true,
});

console.log("Kai Studio desktop bundle prepared.");
