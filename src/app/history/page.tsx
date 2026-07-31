"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import type { SavedRun } from "@/types/run";
import { DashboardBackLink } from "@/components/dashboard-back-link";

export default function HistoryPage() {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runToDelete, setRunToDelete] = useState<SavedRun | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    fetch("/api/runs")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load saved runs.");
        return response.json() as Promise<SavedRun[]>;
      })
      .then(setRuns)
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setLoading(false));
  }, []);

  async function confirmDelete() {
    if (!runToDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");

    try {
      const response = await fetch(`/api/runs/${runToDelete.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Could not delete this conversation.");
      }

      setRuns((current) =>
        current.filter((run) => run.id !== runToDelete.id),
      );
      setRunToDelete(null);
    } catch (failure) {
      setDeleteError(
        failure instanceof Error
          ? failure.message
          : "Could not delete this conversation.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell>
      <section className="flex-1 px-6 py-12 sm:px-10 lg:px-14">
        <div className="mx-auto max-w-6xl">
          <DashboardBackLink />
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-400">
            Run History
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            Saved local runs
          </h1>
          <p className="mt-3 text-slate-400">
            Reopen conversations and continue exactly where you left off.
          </p>

          {loading && <p className="mt-10 text-sm text-slate-500">Loading runs…</p>}
          {error && <p className="mt-10 text-sm text-red-300">{error}</p>}

          {!loading && !error && runs.length === 0 && (
            <div className="mt-10 rounded-2xl border border-dashed border-white/10 p-10 text-center">
              <p className="font-medium text-slate-300">No saved runs yet</p>
              <p className="mt-2 text-sm text-slate-500">
                Complete a Gemma run and it will appear here automatically.
              </p>
              <Link
                href="/workflows/meeting-intelligence"
                className="mt-5 inline-flex rounded-xl border border-sky-400/25 bg-sky-400/15 px-4 py-2.5 text-sm font-medium text-sky-200"
              >
                Open Runner
              </Link>
            </div>
          )}

          <div className="mt-10 grid gap-4">
            {runs.map((run) => (
              <article
                key={run.id}
                className="group flex items-stretch rounded-2xl border border-white/10 bg-white/[0.025] transition hover:border-sky-400/40 hover:bg-white/[0.045]"
              >
                <Link
                  href={`/history/${run.id}`}
                  className="min-w-0 flex-1 p-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {run.title ?? run.accountName}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {run.workflowName} · {run.salespersonName}
                      </p>
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <p className="text-xs text-sky-300">{run.model}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {new Date(run.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setRunToDelete(run);
                    setDeleteError("");
                  }}
                  className="m-3 flex w-10 shrink-0 items-center justify-center rounded-xl border border-transparent text-slate-600 transition hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-300"
                  aria-label={`Delete ${run.title ?? run.accountName}`}
                  title="Delete"
                >
                  ✕
                </button>
              </article>
            ))}
          </div>
        </div>
      </section>

      {runToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-chat-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) {
              setRunToDelete(null);
            }
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111620] p-6 shadow-2xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/10 text-red-300">
              ✕
            </div>
            <h2 id="delete-chat-title" className="mt-5 text-xl font-semibold">
              Are you sure you want to delete this?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              “{runToDelete.title ?? runToDelete.accountName}” and its entire
              conversation will be permanently removed from this Mac.
            </p>
            {deleteError && (
              <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300">
                {deleteError}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRunToDelete(null)}
                disabled={deleting}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="rounded-xl border border-red-400/25 bg-red-400/15 px-4 py-2.5 text-sm font-medium text-red-200 transition hover:bg-red-400/25 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
