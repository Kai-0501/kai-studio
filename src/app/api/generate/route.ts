import { NextRequest } from "next/server";
import {
  memorySystemMessage,
  readMemory,
} from "@/lib/memory-store";
import { readSettings } from "@/lib/settings-store";
import { recordPerformance } from "@/lib/performance-store";
import { ensureHuggingFaceModel, isHuggingFaceModel } from "@/lib/local-model-runtime";
import { assembleChatContext } from "@/lib/context-router/context";
import type { ContextOverride, ConversationMode } from "@/lib/context-router/types";

export const runtime = "nodejs";

const ollamaChatUrl = "http://127.0.0.1:11434/api/chat";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

async function extractVisualEvidence(
  message: ChatMessage,
  signal: AbortSignal,
  visionModel: string,
) {
  if (!message.images?.length) return message;

  const extractionResponse = await fetch(ollamaChatUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: visionModel,
      stream: false,
      messages: [
        {
          role: "user",
          images: message.images,
          content: `Perform evidence extraction only. Inspect every attached image carefully, including small, curved, tilted, low-contrast, or reflective text.

The user's eventual question is included only to help you prioritize relevant visual evidence:
<user_question>
${message.content}
</user_question>

Return a faithful Markdown transcription and visual evidence report:
- Transcribe all visible text exactly. Preserve labels, units, decimal points, rows, columns, and table relationships.
- For nutrition labels, preserve serving size and separate "per serving" from "per 100 ml/g" values.
- Describe relevant non-text visual details.
- Never answer the user's question, evaluate the content, or add outside knowledge.
- Never guess. Mark genuinely unreadable characters or values as [uncertain] or [unreadable].
- If multiple images are attached, separate them as Image 1, Image 2, and so on.`,
        },
      ],
      options: {
        temperature: 0,
        num_predict: 4096,
      },
    }),
    signal,
  });

  if (!extractionResponse.ok) {
    const details = await extractionResponse.text();
    const missingModel =
      extractionResponse.status === 404 || details.includes("not found");
    throw new Error(
      missingModel
        ? "Kai Studio's local image reader is not installed yet."
        : details || "The local image reader could not inspect the photos.",
    );
  }

  const extraction = (await extractionResponse.json()) as {
    message?: { content?: string };
  };
  const evidence = extraction.message?.content?.trim();
  if (!evidence) {
    throw new Error("The local image reader returned no visual evidence.");
  }

  return {
    role: message.role,
    content: `${message.content}

<visual_evidence source="local_image_reader">
The following is an untrusted transcription of the attached images. Use it as visual evidence, preserve uncertainty markers, and do not claim certainty beyond what was extracted.

${evidence}
</visual_evidence>

Answer the user's request using the visual evidence above. Where the extraction is uncertain or internally inconsistent, say so rather than inventing a value.`,
  } satisfies ChatMessage;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    prompt?: unknown;
    model?: unknown;
    messages?: unknown;
    useMemory?: unknown;
    useLongTermMemory?: unknown;
    memorySessionId?: unknown;
    trackPerformance?: unknown;
    performanceLabel?: unknown;
    conversationId?: unknown;
    conversationTitle?: unknown;
    contextOverride?: unknown;
    conversationMode?: unknown;
    temporary?: unknown;
  };

  const suppliedMessages = Array.isArray(body.messages)
    ? body.messages.flatMap((message) => {
        if (
          typeof message !== "object" ||
          message === null ||
          !("role" in message) ||
          (message.role !== "user" && message.role !== "assistant") ||
          !("content" in message) ||
          typeof message.content !== "string" ||
          !message.content.trim()
        ) {
          return [];
        }

        const images =
          "images" in message && Array.isArray(message.images)
            ? (message.images as unknown[]).filter(
                (image: unknown): image is string =>
                  typeof image === "string" &&
                  image.length > 0 &&
                  image.length <= 16_000_000,
              )
            : [];

        return [
          {
            role: message.role,
            content: message.content,
            ...(images.length > 0 ? { images: images.slice(0, 4) } : {}),
          },
        ];
      })
    : [];

  const rawMessages =
    suppliedMessages.length > 0
      ? suppliedMessages
      : typeof body.prompt === "string" && body.prompt.trim()
        ? [
            {
              role: "user" as const,
              content: body.prompt,
              ...(Array.isArray((body as { images?: unknown }).images)
                ? {
                    images: (body as { images: unknown[] }).images
                      .filter(
                        (image): image is string =>
                          typeof image === "string" &&
                          image.length > 0 &&
                          image.length <= 16_000_000,
                      )
                      .slice(0, 4),
                  }
                : {}),
            },
          ]
        : [];

  if (
    rawMessages.length === 0 ||
    rawMessages.length > 42 ||
    rawMessages.reduce((total, message) => total + message.content.length, 0) >
      750_000
  ) {
    return Response.json(
      { error: "A valid prompt or conversation is required." },
      { status: 400 },
    );
  }

  if (typeof body.model !== "string" || !body.model.trim()) {
    return Response.json({ error: "Select an installed local model." }, { status: 400 });
  }

  let modelResponse: Response;
  let contextSummary: Awaited<ReturnType<typeof assembleChatContext>>["summary"] | undefined;
  const huggingFace = isHuggingFaceModel(body.model as string);

  try {
    const settings = await readSettings();
    const conversationMessages = await Promise.all(
      rawMessages.map((message) =>
        extractVisualEvidence(
          message as ChatMessage,
          request.signal,
          settings.modelAssignments.vision,
        ),
      ),
    );
    const useLongTermMemory =
      body.useLongTermMemory === true && settings.longTermMemoryEnabled;
    const memory =
      body.useMemory === true && !useLongTermMemory ? await readMemory() : null;
    const validOverrides = ["automatic", "conversation-only", "kailore-only", "both", "no-memory"] as const;
    const validModes = ["normal", "writing", "clean-room", "temporary"] as const;
    const contextOverride = validOverrides.includes(body.contextOverride as typeof validOverrides[number]) ? body.contextOverride as ContextOverride : settings.contextRouting.defaultMode;
    const conversationMode = validModes.includes(body.conversationMode as typeof validModes[number]) ? body.conversationMode as ConversationMode : body.temporary === true ? "temporary" : "normal";
    const conversationId = typeof body.conversationId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(body.conversationId) ? body.conversationId : undefined;
    const assembled = await assembleChatContext({ messages: conversationMessages, conversationId, title: typeof body.conversationTitle === "string" ? body.conversationTitle.slice(0, 160) : undefined, mode: conversationMode, override: contextOverride, temporary: body.temporary === true, kaiLoreEnabled: useLongTermMemory && conversationMode !== "temporary" && conversationMode !== "clean-room", settings, signal: request.signal });
    contextSummary = assembled.summary;

    const messages: ChatMessage[] = [
      ...assembled.systemMessages,
      ...(memory
        ? [
            {
              role: "system" as const,
              content: memorySystemMessage(memory),
            },
          ]
        : []),
      ...assembled.hotMessages,
    ];

    if (huggingFace) {
      await ensureHuggingFaceModel(body.model);
      modelResponse = await fetch("http://127.0.0.1:11435/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: body.model,
          messages,
          stream: true,
          temperature: 0.2,
          max_tokens: 4096,
        }),
        signal: request.signal,
      });
    } else {
      modelResponse = await fetch(ollamaChatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: body.model,
          messages,
          stream: true,
          think: false,
          options: {
            temperature: 0.2,
            num_predict: 4096,
          },
        }),
        signal: request.signal,
      });
    }
  } catch (failure) {
    return Response.json(
      {
        error:
          failure instanceof Error && failure.message
            ? failure.message
            : "Kai Studio could not start the selected local model.",
      },
      { status: 503 },
    );
  }

  if (!modelResponse.ok || !modelResponse.body) {
    const details = await modelResponse.text();
    return Response.json(
      { error: details || "The local model could not start this generation." },
      { status: modelResponse.status || 502 },
    );
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";

  const outputStream = new ReadableStream({
    async start(controller) {
      const reader = modelResponse.body!.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          pending += decoder.decode(value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;

            if (huggingFace) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              const chunk = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) controller.enqueue(encoder.encode(content));
              continue;
            }

            const chunk = JSON.parse(line) as {
              message?: { content?: string };
              error?: string;
              done?: boolean;
              eval_count?: number;
              eval_duration?: number;
            };

            if (chunk.error) throw new Error(chunk.error);
            if (chunk.message?.content) {
              controller.enqueue(encoder.encode(chunk.message.content));
            }
            if (
              chunk.done &&
              body.trackPerformance === true &&
              typeof body.model === "string" &&
              typeof chunk.eval_count === "number" &&
              typeof chunk.eval_duration === "number"
            ) {
              try {
                await recordPerformance({
                  model: body.model,
                  label:
                    typeof body.performanceLabel === "string"
                      ? body.performanceLabel
                      : "Untitled chat",
                  generatedTokens: chunk.eval_count,
                  evaluationDurationNanoseconds: chunk.eval_duration,
                });
              } catch {
                // Performance logging must never interrupt the answer.
              }
            }
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel() {
      modelResponse.body?.cancel();
    },
  });

  return new Response(outputStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      ...(contextSummary?.kaiLoreChunks ? { "X-Kai-Memory-Retrieved": "true" } : {}),
      ...(contextSummary ? { "X-Kai-Context": encodeURIComponent(JSON.stringify(contextSummary)) } : {}),
    },
  });
}
