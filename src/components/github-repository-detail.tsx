"use client";

import Link from "next/link";
import { MarkdownResponse } from "@/components/markdown-response";
import type { OwnedGitHubRepository } from "@/types/github";

export function GitHubRepositoryDetail({ repository }: { repository: OwnedGitHubRepository }) {
  return (
    <section className="flex-1 px-6 py-12 sm:px-10 lg:px-14">
      <div className="mx-auto max-w-4xl">
        <Link href="/github" className="text-sm text-slate-400 hover:text-sky-300">← Your repositories</Link>
        <div className="mt-7 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-400">Owned repository</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{repository.name}</h1>
            {repository.description && <p className="mt-3 max-w-2xl text-slate-400">{repository.description}</p>}
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
              {repository.language && <span className="rounded-full bg-white/5 px-3 py-1">{repository.language}</span>}
              {repository.private && <span className="rounded-full bg-white/5 px-3 py-1">Private</span>}
              {repository.topics.map((topic) => <span key={topic} className="rounded-full bg-sky-400/10 px-3 py-1 text-sky-300">{topic}</span>)}
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <Link href={`/chat/github/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`} className="rounded-xl bg-sky-500 px-5 py-3 text-center text-sm font-medium text-black hover:bg-sky-400">Build with Gemma 4 31B</Link>
            <a href={repository.url} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-5 py-2.5 text-center text-sm text-slate-300 hover:border-sky-400/40">Open on GitHub ↗</a>
          </div>
        </div>
        <div className="mt-10">
          {repository.readme ? <MarkdownResponse>{repository.readme}</MarkdownResponse> : <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">This repository does not have a README yet.</div>}
        </div>
        <p className="mt-5 text-xs text-slate-600">Default branch: {repository.defaultBranch} · updated {new Date(repository.updatedAt).toLocaleString()}</p>
      </div>
    </section>
  );
}
