import { pathToFileURL } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return {
      url: pathToFileURL(
        path.join(process.cwd(), "src", `${specifier.slice(2)}.ts`),
      ).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
