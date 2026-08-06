"use client";

import { ChangeEvent, FormEvent, useRef, useState } from "react";
import type { FollowUpMessage } from "@/types/run";
import {
  filesToImageAttachments,
  imagePayload,
  MAX_IMAGES,
  type ImageAttachment,
} from "@/lib/image-attachments";
import { MarkdownResponse } from "@/components/markdown-response";

type FollowUpChatProps = {
  compiledPrompt: string;
  initialOutput: string;
  model: string;
  runId?: string;
  accent?: "violet" | "sky" | "amber" | "emerald";
  initialImages?: ImageAttachment[];
  allowImages?: boolean;
  embedded?: boolean;
  suggestions?: string[];
};

const accentStyles = {
  violet: {
    border: "border-violet-400/20",
    background: "bg-violet-500/[0.025]",
    button: "bg-violet-500 hover:bg-violet-400",
    user: "border-violet-400/20 bg-violet-500/10",
    label: "text-violet-300",
  },
  sky: {
    border: "border-sky-400/20",
    background: "bg-sky-500/[0.025]",
    button: "bg-sky-500 hover:bg-sky-400",
    user: "border-sky-400/20 bg-sky-500/10",
    label: "text-sky-300",
  },
  amber: {
    border: "border-amber-400/20",
    background: "bg-amber-500/[0.025]",
    button: "bg-amber-500 text-black hover:bg-amber-400",
    user: "border-amber-400/20 bg-amber-500/10",
    label: "text-amber-300",
  },
  emerald: {
    border: "border-emerald-400/20",
    background: "bg-emerald-500/[0.025]",
    button: "bg-emerald-500 text-black hover:bg-emerald-400",
    user: "border-emerald-400/20 bg-emerald-500/10",
    label: "text-emerald-300",
  },
};

export function FollowUpChat({
  compiledPrompt,
  initialOutput,
  model,
  runId,
  accent = "violet",
  initialImages = [],
  allowImages = false,
  embedded = false,
  suggestions = [],
}: FollowUpChatProps) {
  const [messages, setMessages] = useState<FollowUpMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const styles = accentStyles[accent];

  async function askFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedQuestion = question.trim();
    if (!cleanedQuestion || isRunning) return;

    const userMessage: FollowUpMessage = {
      role: "user",
      content: cleanedQuestion,
      createdAt: new Date().toISOString(),
    };
    const messagesBeforeAnswer = [...messages, userMessage];
    setMessages(messagesBeforeAnswer);
    setQuestion("");
    setError("");
    setIsRunning(true);

    let completeAnswer = "";
    const assistantCreatedAt = new Date().toISOString();

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          useMemory: false,
          useLongTermMemory: true,
          conversationId: runId,
          contextOverride: "automatic",
          conversationMode: "normal",
          temporary: false,
          messages: [
            {
              role: "user",
              content: compiledPrompt,
              ...(initialImages.length > 0
                ? { images: imagePayload(initialImages) }
                : {}),
            },
            { role: "assistant", content: initialOutput },
            ...messagesBeforeAnswer.map(({ role, content }, index) => ({
              role,
              content,
              ...(index === messagesBeforeAnswer.length - 1 &&
              role === "user" &&
              images.length > 0
                ? { images: imagePayload(images) }
                : {}),
            })),
          ],
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Gemma could not answer the follow-up.");
      }
      if (!response.body) throw new Error("Gemma returned an empty response.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        completeAnswer += decoder.decode(value, { stream: true });
        setMessages([
          ...messagesBeforeAnswer,
          {
            role: "assistant",
            content: completeAnswer,
            createdAt: assistantCreatedAt,
          },
        ]);
      }

      const completedConversation: FollowUpMessage[] = [
        ...messagesBeforeAnswer,
        {
          role: "assistant",
          content: completeAnswer,
          createdAt: assistantCreatedAt,
        },
      ];
      setMessages(completedConversation);
      setImages([]);

      if (runId) {
        await fetch(`/api/runs/${runId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ followUps: completedConversation }),
        });
      }
    } catch (failure) {
      setMessages(messagesBeforeAnswer);
      setError(
        failure instanceof Error
          ? failure.message
          : "Gemma could not answer the follow-up.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function addImages(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;
    try {
      const added = await filesToImageAttachments(
        event.target.files,
        images.length,
      );
      setImages((current) => [...current, ...added]);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not add that photo.",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function copyReply(content: string, index: number) {
    const copied = await copyText(content);
    if (copied) setCopiedIndex(index);
  }

  return (
    <section
      className={
        embedded
          ? "border-t border-white/10 pt-6"
          : `rounded-2xl border ${styles.border} ${styles.background} p-6 sm:p-8`
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Continue with Gemma</h2>
          <p className="mt-1 text-sm text-slate-500">
            Ask follow-up questions without rebuilding the workflow.
          </p>
        </div>
        <p className={`text-xs ${styles.label}`}>
          {model} · conversation remains local
        </p>
      </div>

      {messages.length > 0 && (
        <div className="mt-6 space-y-4 border-t border-white/10 pt-6">
          {messages.map((message, index) => (
            <article
              key={`${message.createdAt}-${index}`}
              className={`rounded-xl border p-4 ${
                message.role === "user"
                  ? `${styles.user} ml-auto max-w-3xl`
                  : "border-white/10 bg-[#080b12]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p
                  className={`text-xs font-medium ${
                    message.role === "user" ? styles.label : "text-emerald-300"
                  }`}
                >
                  {message.role === "user" ? "You" : "Gemma"}
                </p>
                {message.role === "assistant" && message.content && !isRunning && (
                  <button
                    type="button"
                    onClick={() => copyReply(message.content, index)}
                    className="text-xs text-slate-500 hover:text-white"
                  >
                    {copiedIndex === index ? "Copied ✓" : "Copy"}
                  </button>
                )}
              </div>
              {message.role === "assistant" && message.content ? (
                <MarkdownResponse className="mt-3 border-0 bg-transparent p-0">
                  {message.content}
                </MarkdownResponse>
              ) : (
                <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">
                  {message.content ||
                    (isRunning ? "Thinking…" : "No response")}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={askFollowUp} className="mt-6">
        {messages.length === 0 && suggestions.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium text-slate-500">
              Suggested next questions
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.slice(0, 3).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setQuestion(suggestion)}
                  className="rounded-full border border-white/10 bg-white/[0.025] px-3 py-2 text-left text-xs text-slate-400 transition hover:border-white/20 hover:text-white"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="block">
          <span className="text-sm font-medium">Ask a follow-up</span>
          <textarea
            rows={3}
            value={question}
            disabled={isRunning}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={
              suggestions[0] || "Ask Gemma anything about this response..."
            }
            className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-[#080b12] px-4 py-3 text-sm leading-6 outline-none transition placeholder:text-slate-600 focus:border-white/25 disabled:opacity-60"
          />
        </label>
        {allowImages && (
          <div className="mt-3">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={addImages}
              className="hidden"
            />
            {images.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-3">
                {images.map((image) => (
                  <div
                    key={image.id}
                    className="relative h-20 w-20 overflow-hidden rounded-xl border border-white/10"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.dataUrl}
                      alt={image.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setImages((current) =>
                          current.filter((item) => item.id !== image.id),
                        )
                      }
                      aria-label={`Remove ${image.name}`}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white hover:bg-red-500"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              disabled={images.length >= MAX_IMAGES || isRunning}
              onClick={() => imageInputRef.current?.click()}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 transition hover:border-white/20 hover:text-white disabled:opacity-40"
            >
              ＋ Attach photos
            </button>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-600">
            The original prompt, output, and conversation stay in context.
          </p>
          <button
            type="submit"
            disabled={!question.trim() || isRunning}
            className={`rounded-xl px-5 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles.button}`}
          >
            {isRunning ? "Replying…" : "Ask Gemma"}
          </button>
        </div>
      </form>
    </section>
  );
}

async function copyText(text: string) {
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error();
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}
