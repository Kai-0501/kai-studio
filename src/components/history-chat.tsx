"use client";

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { MarkdownResponse } from "@/components/markdown-response";
import { ResponseActions } from "@/components/response-actions";
import { DiagnosticPlanPicker } from "@/components/diagnostic-plan-picker";
import {
  filesToImageAttachments,
  imagePayload,
  MAX_IMAGES,
  type ImageAttachment,
} from "@/lib/image-attachments";
import type { FollowUpMessage, SavedRun } from "@/types/run";

export function HistoryChat({
  run,
  onUpdate,
}: {
  run: SavedRun;
  onUpdate: (run: SavedRun) => void;
}) {
  const [messages, setMessages] = useState<FollowUpMessage[]>(
    run.followUps ?? [],
  );
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [model, setModel] = useState(run.model);
  const [error, setError] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoFollowRef = useRef(true);

  useEffect(() => {
    if (!shouldAutoFollowRef.current) return;

    const frame = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [messages, isRunning]);

  function handleConversationScroll() {
    const container = scrollContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoFollowRef.current = distanceFromBottom < 120;
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

  async function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = draft.trim();
    if ((!content && images.length === 0) || isRunning) return;

    const userMessage: FollowUpMessage = {
      role: "user",
      content:
        content || "Please examine the attached image and tell me what you see.",
      createdAt: new Date().toISOString(),
    };
    const messagesBeforeAnswer = [...messages, userMessage];
    const assistantCreatedAt = new Date().toISOString();

    shouldAutoFollowRef.current = true;
    setMessages(messagesBeforeAnswer);
    setDraft("");
    setError("");
    setIsRunning(true);

    let completeAnswer = "";

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          trackPerformance: true,
          performanceLabel: run.title ?? run.accountName,
          useMemory: true,
          messages: [
            { role: "user", content: run.compiledPrompt },
            { role: "assistant", content: run.output },
            ...messagesBeforeAnswer.map((message, index) => ({
              role: message.role,
              content: message.content,
              ...(index === messagesBeforeAnswer.length - 1 &&
              message.role === "user" &&
              images.length > 0
                ? { images: imagePayload(images) }
                : {}),
            })),
          ],
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Kai Studio could not answer.");
      }
      if (!response.body) {
        throw new Error("Kai Studio returned an empty response.");
      }

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

      const saveResponse = await fetch(`/api/runs/${run.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followUps: completedConversation }),
      });
      if (saveResponse.ok) {
        const updated = (await saveResponse.json()) as SavedRun;
        onUpdate(updated);
      }
    } catch (failure) {
      setMessages(messages);
      setError(
        failure instanceof Error ? failure.message : "Kai Studio could not answer.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function regenerateLastResponse(nextModel: string) {
    if (isRunning) return;

    const previousMessages = messages;
    const isInitialResponse = messages.length === 0;
    const context: FollowUpMessage[] = isInitialResponse
      ? [
          {
            role: "user",
            content: run.compiledPrompt,
            createdAt: run.createdAt,
          },
        ]
      : [
          {
            role: "user",
            content: run.compiledPrompt,
            createdAt: run.createdAt,
          },
          {
            role: "assistant",
            content: run.output,
            createdAt: run.createdAt,
          },
          ...messages.slice(0, -1),
        ];
    const assistantCreatedAt = new Date().toISOString();

    setModel(nextModel);
    setError("");
    setIsRunning(true);
    shouldAutoFollowRef.current = false;
    if (!isInitialResponse) {
      setMessages(messages.slice(0, -1));
    }

    let completeAnswer = "";

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: nextModel,
          trackPerformance: true,
          performanceLabel: run.title ?? run.accountName,
          useMemory: true,
          messages: context.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Kai Studio could not regenerate that reply.");
      }
      if (!response.body) throw new Error("Kai Studio returned an empty response.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        completeAnswer += decoder.decode(value, { stream: true });
        if (!isInitialResponse) {
          setMessages([
            ...messages.slice(0, -1),
            {
              role: "assistant",
              content: completeAnswer,
              createdAt: assistantCreatedAt,
            },
          ]);
        }
      }

      const patch = isInitialResponse
        ? { output: completeAnswer, model: nextModel }
        : {
            model: nextModel,
            followUps: [
              ...messages.slice(0, -1),
              {
                role: "assistant" as const,
                content: completeAnswer,
                createdAt: assistantCreatedAt,
              },
            ],
          };
      const saveResponse = await fetch(`/api/runs/${run.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!saveResponse.ok) throw new Error("The regenerated reply could not be saved.");

      const updated = (await saveResponse.json()) as SavedRun;
      onUpdate(updated);
      if (isInitialResponse) {
        setMessages(updated.followUps ?? []);
      } else {
        setMessages(updated.followUps ?? []);
      }
    } catch (failure) {
      setMessages(previousMessages);
      setModel(run.model);
      setError(
        failure instanceof Error
          ? failure.message
          : "Kai Studio could not regenerate that reply.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  const conversation: FollowUpMessage[] = [
    {
      role: "user",
      content: run.transcript,
      createdAt: run.createdAt,
    },
    {
      role: "assistant",
      content: run.output,
      createdAt: run.createdAt,
    },
    ...messages,
  ];

  return (
    <section className="relative flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-[#0a0d14]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.06] px-5 sm:px-8">
        <Link
          href="/"
          className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
        >
          ← Dashboard
        </Link>
        <div className="min-w-0 px-4 text-center">
          <p className="truncate text-sm font-medium">
            {run.title ?? run.accountName}
          </p>
          <p className="text-[11px] text-slate-500">
            {run.model} · saved locally
          </p>
        </div>
        <div className="w-[76px]" />
      </header>

      <div
        ref={scrollContainerRef}
        onScroll={handleConversationScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl px-5 pb-40 pt-8 sm:px-8">
          <div className="space-y-8">
            {conversation.map((message, index) => (
              <article
                key={`${message.createdAt}-${index}`}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[85%]"
                    : "max-w-full"
                }
              >
                {message.role === "user" ? (
                  <div className="rounded-3xl rounded-br-md bg-[#20242d] px-5 py-3.5 text-sm leading-7 text-slate-100">
                    {message.content}
                  </div>
                ) : (
                  <>
                    <div className="flex gap-4">
                      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-400/20 text-xs font-bold text-sky-200">
                        K
                      </div>
                      {message.content ? (
                        <MarkdownResponse className="min-w-0 flex-1 border-0 bg-transparent p-0">
                          {message.content}
                        </MarkdownResponse>
                      ) : (
                        <span className="animate-pulse pt-1 text-sm text-slate-500">
                          Thinking…
                        </span>
                      )}
                    </div>
                    {index === conversation.length - 1 &&
                      message.content &&
                      !isRunning && (
                        <>
                        <ResponseActions
                          content={message.content}
                          currentModel={model}
                          onRegenerate={regenerateLastResponse}
                        />
                        {run.workflowId === "diagnostics" && (
                          <DiagnosticPlanPicker run={run} />
                        )}
                        </>
                      )}
                  </>
                )}
              </article>
            ))}

            {isRunning &&
              conversation[conversation.length - 1]?.role === "user" && (
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500 text-xs font-bold text-white">
                    K
                  </span>
                  <span className="animate-pulse">Thinking…</span>
                </div>
              )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0a0d14] via-[#0a0d14] to-transparent px-4 pb-5 pt-14 sm:px-8">
        <form
          onSubmit={sendMessage}
          className="pointer-events-auto mx-auto max-w-3xl rounded-[1.65rem] border border-white/10 bg-[#181c24] p-2 shadow-2xl shadow-black/35 focus-within:border-white/20"
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pb-2">
              {images.map((image) => (
                <div key={image.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.dataUrl}
                    alt={image.name}
                    className="h-20 w-20 rounded-xl object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setImages((current) =>
                        current.filter((item) => item.id !== image.id),
                      )
                    }
                    className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/90 text-sm hover:bg-red-500"
                    aria-label={`Remove ${image.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            rows={1}
            value={draft}
            disabled={isRunning}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Continue this conversation"
            className="max-h-40 min-h-12 w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-6 outline-none placeholder:text-slate-600 disabled:opacity-60"
          />

          {error && (
            <p className="mx-2 mb-2 rounded-lg bg-red-400/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between px-1 pb-1">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={addImages}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={images.length >= MAX_IMAGES || isRunning}
              className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              aria-label="Attach photos"
            >
              ＋
            </button>
            <button
              type="submit"
              disabled={(!draft.trim() && images.length === 0) || isRunning}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-semibold text-black transition hover:bg-slate-200 disabled:bg-white/10 disabled:text-slate-600"
              aria-label="Send message"
            >
              {isRunning ? "·" : "↑"}
            </button>
          </div>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-slate-700">
          Continuing with {model}. Conversation remains on this Mac.
        </p>
      </div>
    </section>
  );
}
