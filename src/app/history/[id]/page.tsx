"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { HistoryChat } from "@/components/history-chat";
import { MarkdownResponse } from "@/components/markdown-response";
import type { SavedRun } from "@/types/run";
import { DashboardBackLink } from "@/components/dashboard-back-link";

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<SavedRun | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/runs/${id}`)
      .then((response) => {
        if (!response.ok) throw new Error("This saved run could not be found.");
        return response.json() as Promise<SavedRun>;
      })
      .then(setRun)
      .catch((failure: Error) => setError(failure.message));
  }, [id]);

  const isChat =
    run?.workflowId === "general-intelligence" &&
    (run.inputLabel === "Chat" || run.salespersonName === "Chat");

  if (run && isChat) {
    return (
      <AppShell>
        <HistoryChat run={run} onUpdate={setRun} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="flex-1 px-6 py-10 sm:px-10 lg:px-14">
        <div className="mx-auto max-w-6xl">
          <DashboardBackLink />
          <Link href="/history" className="text-sm text-slate-400 hover:text-white">
            ← Back to History
          </Link>

          {error && <p className="mt-10 text-red-300">{error}</p>}
          {!run && !error && <p className="mt-10 text-slate-500">Loading run…</p>}

          {run && (
            <>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-violet-300">
                    {run.workflowName}
                  </p>
                  <h1 className="mt-2 text-4xl font-semibold">{run.accountName}</h1>
                  <p className="mt-2 text-sm text-slate-500">
                    {run.salespersonName} · {new Date(run.createdAt).toLocaleString()}
                  </p>
                </div>
                <span className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400">
                  {run.model}
                </span>
              </div>

              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-6">
                  <h2 className="text-sm font-medium">
                    {run.inputLabel ?? "Original transcript"}
                  </h2>
                  <pre className="mt-4 max-h-[36rem] overflow-auto whitespace-pre-wrap text-sm leading-7 text-slate-400">
                    {run.transcript}
                  </pre>
                </article>
                <article className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.025] p-6">
                  <h2 className="text-sm font-medium">Gemma output</h2>
                  <MarkdownResponse className="mt-4 max-h-[36rem] border-0 bg-transparent p-0">
                    {run.output}
                  </MarkdownResponse>
                </article>
              </div>

              {run.followUps && run.followUps.length > 0 && (
                <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <div>
                    <h2 className="text-sm font-medium">
                      Follow-up conversation
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Continued locally after the initial workflow output.
                    </p>
                  </div>
                  <div className="mt-5 space-y-4">
                    {run.followUps.map((message, index) => (
                      <article
                        key={`${message.createdAt}-${index}`}
                        className={`rounded-xl border p-4 ${
                          message.role === "user"
                            ? "ml-auto max-w-3xl border-violet-400/20 bg-violet-500/10"
                            : "border-white/10 bg-[#080b12]"
                        }`}
                      >
                        <p
                          className={`text-xs font-medium ${
                            message.role === "user"
                              ? "text-violet-300"
                              : "text-emerald-300"
                          }`}
                        >
                          {message.role === "user" ? "You" : "Gemma"}
                        </p>
                        {message.role === "assistant" ? (
                          <MarkdownResponse className="mt-3 border-0 bg-transparent p-0">
                            {message.content}
                          </MarkdownResponse>
                        ) : (
                          <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">
                            {message.content}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </section>
    </AppShell>
  );
}
