"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GitHubVaultStatus } from "@/types/github";

export function GitHubVault() {
  const [status, setStatus] = useState<GitHubVaultStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function sync() {
    setSyncing(true);
    try {
      const response = await fetch("/api/github/sync", { method: "POST" });
      setStatus((await response.json()) as GitHubVaultStatus);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    fetch("/api/github")
      .then((response) => response.json() as Promise<GitHubVaultStatus>)
      .then((cached) => {
        setStatus(cached);
        return fetch("/api/github/sync", { method: "POST" });
      })
      .then((response) => response.json() as Promise<GitHubVaultStatus>)
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  return (
    <section className="flex-1 px-6 py-12 sm:px-10 lg:px-14">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="text-sm text-slate-400 hover:text-sky-300">← Dashboard</Link>
        <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-400">GitHub vault</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your repositories</h1>
            <p className="mt-3 text-slate-400">The newest 40 repositories owned by your GitHub account, cached locally.</p>
          </div>
          <button type="button" onClick={() => void sync()} disabled={syncing} className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-medium text-black disabled:opacity-50">{syncing ? "Syncing…" : "Sync now"}</button>
        </div>

        {!status && <p className="mt-10 text-sm text-slate-500">Loading your repositories…</p>}
        {status?.error && <p className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">Showing the local copy. {status.error}</p>}
        {status && !status.connected && (
          <div className="mt-10 rounded-2xl border border-sky-400/20 bg-sky-400/[0.04] p-8">
            <h2 className="text-xl font-semibold">GitHub needs to be connected</h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">Sign in with GitHub CLI on this Mac. Kai Studio will only accept repositories whose owner exactly matches the signed-in account.</p>
            <code className="mt-5 inline-flex rounded-lg bg-black/30 px-3 py-2 text-sm text-sky-200">gh auth login</code>
          </div>
        )}
        {status?.connected && status.repositories.length === 0 && (
          <div className="mt-10 rounded-2xl border border-dashed border-white/10 p-10 text-center"><h2 className="font-semibold">No owned repositories found</h2></div>
        )}
        {status && status.repositories.length > 0 && (
          <div className="mt-10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            {status.repositories.map((repository) => (
              <Link key={repository.id} href={`/github/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`} className="flex items-center justify-between gap-5 border-b border-white/[0.07] px-5 py-4 last:border-b-0 hover:bg-sky-400/[0.05]">
                <span className="font-medium text-slate-200">{repository.name}</span>
                <span className="shrink-0 text-sky-300">→</span>
              </Link>
            ))}
          </div>
        )}
        {status?.syncedAt && <p className="mt-5 text-xs text-slate-600">Signed in as {status.login} · last synced {new Date(status.syncedAt).toLocaleString()} · forks excluded</p>}
      </div>
    </section>
  );
}
