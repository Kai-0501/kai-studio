import { createHash } from "node:crypto";
import path from "node:path";
import type {
  MemoryConfidence,
  MemoryOperation,
  MemoryRecord,
  MemoryRelationship,
  MemoryStatus,
} from "@/types/memory";

type Scalar = string | number | boolean;
type FrontMatter = Record<string, Scalar | Scalar[]>;

const statuses = new Set<MemoryStatus>([
  "active",
  "uncertain",
  "superseded",
  "deprecated",
  "forgotten",
]);
const operations = new Set<MemoryOperation>([
  "upsert",
  "supersede",
  "deprecate",
  "delete",
  "forget",
]);
const confidences = new Set<MemoryConfidence>([
  "low",
  "medium",
  "high",
  "unknown",
]);

function unquote(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function scalar(value: string): Scalar {
  const text = unquote(value);
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function parseInlineArray(value: string): Scalar[] {
  const inside = value.trim().slice(1, -1);
  if (!inside.trim()) return [];
  return inside.split(",").map((item) => scalar(item));
}

/**
 * Intentionally supports the conservative YAML subset used by KaiLore:
 * scalar keys, inline arrays, and dash lists. Unsupported nesting remains text.
 */
export function parseMarkdownMemory(
  markdown: string,
  sourceFile: string,
): MemoryRecord {
  const normalized = markdown.replace(/\r\n/g, "\n");
  let body = normalized;
  const metadata: FrontMatter = {};

  if (normalized.startsWith("---\n")) {
    const end = normalized.indexOf("\n---\n", 4);
    if (end >= 0) {
      const lines = normalized.slice(4, end).split("\n");
      let arrayKey: string | null = null;
      for (const rawLine of lines) {
        const listMatch = rawLine.match(/^\s*-\s+(.+)$/);
        if (listMatch && arrayKey) {
          const current = metadata[arrayKey];
          metadata[arrayKey] = [
            ...(Array.isArray(current) ? current : []),
            scalar(listMatch[1]),
          ];
          continue;
        }
        const keyMatch = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!keyMatch) {
          arrayKey = null;
          continue;
        }
        const [, key, rawValue] = keyMatch;
        if (!rawValue.trim()) {
          metadata[key] = [];
          arrayKey = key;
        } else {
          metadata[key] = rawValue.trim().startsWith("[")
            ? parseInlineArray(rawValue)
            : scalar(rawValue);
          arrayKey = null;
        }
      }
      body = normalized.slice(end + 5).trim();
    }
  }

  const strings = (key: string) => {
    const value = metadata[key];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string" && value.trim()) return [value.trim()];
    return [];
  };
  const text = (key: string, fallback = "") => {
    const value = metadata[key];
    return typeof value === "string" ? value.trim() : fallback;
  };
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const relative = sourceFile.split(path.sep).join("/");
  const fallbackId = relative
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const rawStatus = text("status", "active").toLowerCase() as MemoryStatus;
  const rawOperation = text("operation", "upsert").toLowerCase() as MemoryOperation;
  const rawConfidence = text(
    "confidence",
    "unknown",
  ).toLowerCase() as MemoryConfidence;
  const relationships: MemoryRelationship[] = strings("relationships").map(
    (relationship) => {
      const [type, ...target] = relationship.split(":");
      return {
        type: target.length ? type.trim() : "related",
        targetId: (target.length ? target.join(":") : type).trim(),
      };
    },
  );

  return {
    id: text("id", text("memory_id", fallbackId)),
    title: text("title", heading ?? path.basename(sourceFile, ".md")),
    content: body,
    category: text("category", text("domain", "general")),
    domain: text("domain", text("category", "general")),
    people: strings("people"),
    entities: strings("entities"),
    tags: strings("tags"),
    createdAt: text("created_at") || null,
    updatedAt: text("updated_at", text("last_updated")) || null,
    confidence: confidences.has(rawConfidence) ? rawConfidence : "unknown",
    status: statuses.has(rawStatus) ? rawStatus : "uncertain",
    source: text("source", text("source_type", "kailore")),
    sourceFile: relative,
    relationships,
    importance: Math.min(
      1,
      Math.max(0, Number(metadata.importance ?? 0.5) || 0.5),
    ),
    accessCount: 0,
    lastAccessedAt: null,
    ...(text("valid_from") ? { validFrom: text("valid_from") } : {}),
    ...(text("valid_to") ? { validTo: text("valid_to") } : {}),
    operation: operations.has(rawOperation) ? rawOperation : "upsert",
    supersedes: strings("supersedes"),
    uncertainty: [
      ...strings("uncertainty"),
      ...strings("unknowns"),
      ...(rawStatus === "uncertain" ? ["Record status is uncertain."] : []),
    ],
    contentHash: createHash("sha256").update(normalized).digest("hex"),
  };
}
