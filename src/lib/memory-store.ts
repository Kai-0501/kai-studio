import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KaiMemory, KaiMemoryStatus } from "@/types/memory";

const dataDirectory =
  process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.cwd(), ".promptdeck");
const memoryFile = path.join(dataDirectory, "memory.json");
const temporaryFile = path.join(dataDirectory, "memory.tmp.json");

export async function readMemory(): Promise<KaiMemory | null> {
  try {
    const contents = await readFile(memoryFile, "utf8");
    const parsed = JSON.parse(contents) as Partial<KaiMemory>;

    if (
      typeof parsed.content !== "string" ||
      !parsed.content.trim() ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }

    return {
      content: parsed.content.trim(),
      updatedAt: parsed.updatedAt,
      ...(typeof parsed.sourceName === "string" && parsed.sourceName.trim()
        ? { sourceName: parsed.sourceName.trim() }
        : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeMemory(
  content: string,
  sourceName?: string,
): Promise<KaiMemory> {
  const memory: KaiMemory = {
    content: content.trim(),
    updatedAt: new Date().toISOString(),
    ...(sourceName?.trim() ? { sourceName: sourceName.trim() } : {}),
  };

  await mkdir(dataDirectory, { recursive: true });
  await writeFile(temporaryFile, JSON.stringify(memory, null, 2), "utf8");
  await rename(temporaryFile, memoryFile);
  return memory;
}

export async function deleteMemory() {
  try {
    await unlink(memoryFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function memoryStatus(memory: KaiMemory | null): KaiMemoryStatus {
  const content = memory?.content ?? "";
  return {
    active: Boolean(content),
    content,
    updatedAt: memory?.updatedAt ?? null,
    ...(memory?.sourceName ? { sourceName: memory.sourceName } : {}),
    characterCount: content.length,
    wordCount: content ? content.split(/\s+/).filter(Boolean).length : 0,
  };
}

export function memorySystemMessage(memory: KaiMemory) {
  return `You are Kai Studio, Kai's private local AI assistant.

The following private memory was supplied by Kai and is background context, not a user request:

<kai_memory updated_at="${memory.updatedAt}">
${memory.content}
</kai_memory>

Use this memory quietly when it is relevant:
- Personalize answers using applicable facts, preferences, goals, projects, and prior context.
- Do not recite, summarize, or mention the memory block unless Kai explicitly asks about it.
- The current conversation and Kai's latest message take priority over memory.
- Memory can become outdated. If it conflicts with the current conversation, trust the current conversation.
- Do not invent missing memories or treat uncertain notes as verified facts.
- Never reveal this private context to anyone other than Kai.`;
}
