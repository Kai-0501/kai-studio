import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync, type Dirent } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LocalModel } from "@/types/settings";

type DiscoveryOptions = { extraRoots?: string[]; managedRoots?: string[] };
type CachedDiscovery = { signature: string; models: LocalModel[] };
let cache: CachedDiscovery | undefined;

const MAX_DEPTH = 5;
const MAX_ENTRIES_PER_DIRECTORY = 1_000;

function localModelId(canonicalPath: string) {
  return `local:${createHash("sha256").update(canonicalPath).digest("hex").slice(0, 20)}`;
}

function defaultRoots() {
  const home = os.homedir();
  return [
    { path: path.join(home, "Models"), source: "user-managed-local" as const, ownership: "user-managed" as const },
    { path: path.join(home, ".cache", "huggingface", "hub"), source: "huggingface-cache" as const, ownership: "user-managed" as const },
    { path: path.join(home, "Library", "Application Support", "Kai Studio", "models"), source: "kai-managed-huggingface" as const, ownership: "kai-managed" as const },
    { path: path.join(home, "Library", "Application Support", "Kai Studio", "mlx"), source: "managed-mlx" as const, ownership: "kai-managed" as const },
    { path: path.join(home, "Library", "Application Support", "Kai Studio", "llama.cpp"), source: "managed-llamacpp" as const, ownership: "kai-managed" as const },
  ];
}

function isContained(candidate: string, root: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function readableRoot(root: string) {
  try {
    const canonical = realpathSync(root);
    return statSync(canonical).isDirectory() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function sizeLabel(bytes: number) {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function modelNameFromPath(candidate: string) {
  return path.basename(candidate)
    .replace(/\.gguf$/i, "")
    .replace(/-00001-of-\d+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function inferredMetadata(name: string) {
  const normalized = name.toLowerCase();
  const parameter = normalized.match(/(?:^|[^\d])(\d+(?:\.\d+)?)\s*b(?:[^a-z]|$)/i)?.[1];
  const quantization = normalized.match(/(?:q\d(?:_[a-z0-9]+)?|[a-z]\d+bit|fp\d+|bf16|f16)/i)?.[0];
  return {
    family: normalized.includes("qwen") ? "Qwen" : normalized.includes("gemma") ? "Gemma" : normalized.includes("llama") ? "Llama" : normalized.includes("mistral") ? "Mistral" : undefined,
    parameterClass: parameter ? `${parameter}B` : undefined,
    quantization: quantization?.toUpperCase(),
    architecture: normalized.includes("moe") || normalized.includes("mtp") ? "moe" as const : "unknown" as const,
  };
}

async function configMetadata(directory: string) {
  try {
    const parsed = JSON.parse(await readFile(path.join(directory, "config.json"), "utf8")) as Record<string, unknown>;
    const architecture = Array.isArray(parsed.architectures) ? String(parsed.architectures[0] ?? "") : "";
    const family = typeof parsed.model_type === "string" ? parsed.model_type : architecture || undefined;
    const params = typeof parsed.num_hidden_layers === "number" && typeof parsed.hidden_size === "number"
      ? undefined
      : undefined;
    return { family, parameterClass: params, architecture: /moe/i.test(architecture) ? "moe" as const : "unknown" as const };
  } catch {
    return {};
  }
}

function statusFor(source: NonNullable<LocalModel["source"]>, runtime: NonNullable<LocalModel["runtime"]>) {
  if (runtime === "llama.cpp") return { status: "candidate" as const, statusReason: "Ready for optional local llama.cpp validation." };
  if (runtime === "mlx") return { status: "candidate" as const, statusReason: "Discovered locally; an MLX runtime must be configured before it can run." };
  return { status: "candidate" as const, statusReason: source === "huggingface-cache" ? "Discovered in the Hugging Face cache; runtime validation is required." : "Discovered locally; runtime validation is required." };
}

async function makeGgufModel(file: string, root: string, source: NonNullable<LocalModel["source"]>, ownership: NonNullable<LocalModel["ownership"]>) {
  const canonicalPath = await realpath(file);
  if (!isContained(canonicalPath, root)) return undefined;
  const fileStat = await stat(canonicalPath);
  const displayName = modelNameFromPath(canonicalPath);
  return {
    name: localModelId(canonicalPath), displayName, size: fileStat.size, modifiedAt: fileStat.mtime.toISOString(),
    provider: "huggingface" as const, source, ownership, runtime: "llama.cpp" as const, canonicalPath,
    ...inferredMetadata(displayName), ...statusFor(source, "llama.cpp"),
  } satisfies LocalModel;
}

async function makeMlxModel(directory: string, root: string, source: NonNullable<LocalModel["source"]>, ownership: NonNullable<LocalModel["ownership"]>) {
  const canonicalPath = await realpath(directory);
  if (!isContained(canonicalPath, root)) return undefined;
  const directoryStat = await stat(canonicalPath);
  const displayName = modelNameFromPath(canonicalPath);
  const config = await configMetadata(canonicalPath);
  return {
    name: localModelId(canonicalPath), displayName, size: 0, modifiedAt: directoryStat.mtime.toISOString(),
    provider: "mlx" as const, source, ownership, runtime: "mlx" as const, canonicalPath,
    ...inferredMetadata(displayName), ...config, ...statusFor(source, "mlx"),
  } satisfies LocalModel;
}

async function scanDirectory(root: string, source: NonNullable<LocalModel["source"]>, ownership: NonNullable<LocalModel["ownership"]>, depth = 0, found: LocalModel[] = []) {
  if (depth > MAX_DEPTH) return found;
  let entries: Dirent[];
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries.slice(0, MAX_ENTRIES_PER_DIRECTORY)) {
    const candidate = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".gguf") && !/^(mmproj|mtp|draft)/i.test(entry.name)) {
      const model = await makeGgufModel(candidate, root, source, ownership);
      if (model) found.push(model);
      continue;
    }
    if (entry.isDirectory()) {
      if (existsSync(path.join(candidate, "config.json")) && (existsSync(path.join(candidate, "model.safetensors")) || existsSync(path.join(candidate, "model.safetensors.index.json")))) {
        const model = await makeMlxModel(candidate, root, source, ownership);
        if (model) found.push(model);
      }
      await scanDirectory(candidate, source, ownership, depth + 1, found);
    }
  }
  return found;
}

function rootsSignature(roots: string[]) {
  return roots.map((root) => {
    try { const data = statSync(root); return `${root}:${data.mtimeMs}:${data.size}`; } catch { return `${root}:missing`; }
  }).join("|");
}

export async function discoverLocalModels(options: DiscoveryOptions = {}) {
  const managed = new Set(options.managedRoots ?? []);
  const roots = [
    ...defaultRoots(),
    ...(options.extraRoots ?? []).map((root) => ({ path: root, source: "manual-registration" as const, ownership: "manual" as const })),
  ].map((root) => ({ ...root, canonical: readableRoot(root.path) })).filter((root): root is typeof root & { canonical: string } => Boolean(root.canonical));
  const signature = rootsSignature(roots.map((root) => root.canonical));
  if (cache?.signature === signature) return cache.models;
  const models: LocalModel[] = [];
  for (const root of roots) {
    const source = managed.has(root.canonical) ? "kai-managed-huggingface" as const : root.source;
    const ownership = managed.has(root.canonical) ? "kai-managed" as const : root.ownership;
    await scanDirectory(root.canonical, source, ownership, 0, models);
  }
  const unique = [...new Map(models.map((model) => [model.canonicalPath ?? model.name, model])).values()];
  cache = { signature, models: unique };
  return unique;
}

export function describeLocalModel(model: LocalModel) {
  const pieces = [model.source?.replaceAll("-", " "), model.parameterClass, model.quantization, model.size ? sizeLabel(model.size) : undefined].filter(Boolean);
  return pieces.join(" · ");
}

export function clearLocalModelDiscoveryCache() { cache = undefined; }
