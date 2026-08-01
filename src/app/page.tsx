"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import type { SavedRun } from "@/types/run";
import type { GenerationPerformance } from "@/types/performance";
import type { GitHubVaultStatus } from "@/types/github";
import type { DiagnosticsJob } from "@/lib/diagnostics-jobs";

export default function DashboardPage() {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [performance, setPerformance] = useState<GenerationPerformance[]>([]);
  const [github, setGitHub] = useState<GitHubVaultStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsJob | null>(null);

  useEffect(() => {
    Promise.all([fetch("/api/runs"), fetch("/api/performance"), fetch("/api/github"), fetch("/api/diagnostics")])
      .then(async ([runsResponse, performanceResponse, githubResponse, diagnosticsResponse]) => {
        setRuns((await runsResponse.json()) as SavedRun[]);
        setPerformance(
          (await performanceResponse.json()) as GenerationPerformance[],
        );
        setGitHub((await githubResponse.json()) as GitHubVaultStatus);
        setDiagnostics((await diagnosticsResponse.json()) as DiagnosticsJob | null);
      })
      .finally(() => setLoading(false));
  }, []);

  const latestRun = runs[0];
  const latestPerformance = performance[0];
  async function startDiagnostics() {
    const response = await fetch("/api/diagnostics", { method: "POST" });
    const job = await response.json() as DiagnosticsJob;
    setDiagnostics(job);
    window.location.href = `/diagnostics/${job.id}`;
  }

  return (
    <AppShell>
      <section className="flex-1 px-6 py-10 sm:px-10 lg:px-14">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Local system ready
              </div>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight">
                Good to see you, Kai.
              </h1>
              <p className="mt-3 text-slate-400">
                Run reliable AI workflows without sending data to the cloud.
              </p>
            </div>

            <Link
              href="/chat"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium text-black transition hover:bg-emerald-400"
            >
              ✦ Chat now
            </Link>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="GitHub repos"
              value={loading ? "—" : github?.connected ? String(github.repositoryCount) : "Connect"}
              detail={github?.connected ? `Owned by ${github.login}` : "Link your GitHub account"}
              href="/github"
            />
            <StatCard
              label="Latest speed"
              value={
                loading
                  ? "—"
                  : latestPerformance
                    ? `${latestPerformance.tokensPerSecond.toFixed(1)} tok/s`
                    : "No data"
              }
              detail={
                latestPerformance
                  ? displayModel(latestPerformance.model)
                  : "Run a normal chat to measure"
              }
              href="/settings#performance"
            />
            <StatCard
              label="Workflows"
              value="4"
              detail="Meeting · Editorial · Account · General"
              href="/library"
            />
            {diagnostics?.status === "running" ? (
              <StatCard label="Diagnostics" value="Running" detail="Open the live diagnostic" href={`/diagnostics/${diagnostics.id}`} />
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                <p className="text-sm text-slate-500">Diagnostics agent</p>
                <p className="mt-4 text-2xl font-semibold">Ready</p>
                <button onClick={startDiagnostics} className="mt-4 text-sm font-medium text-sky-300 hover:text-sky-200">Run diagnostics now →</button>
              </div>
            )}
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Recent runs</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Continue from your latest local outputs.
                  </p>
                </div>
                <Link
                  href="/history"
                  className="text-sm font-medium text-sky-300 hover:text-sky-200"
                >
                  View all →
                </Link>
              </div>

              {loading && (
                <p className="mt-8 text-sm text-slate-500">Loading recent runs…</p>
              )}

              {!loading && runs.length === 0 && (
                <div className="mt-6 rounded-xl border border-dashed border-white/10 p-8 text-center">
                  <p className="text-sm text-slate-400">
                    Your completed Gemma runs will appear here.
                  </p>
                </div>
              )}

              <div className="mt-6 space-y-3">
                {runs.slice(0, 4).map((run) => (
                  <Link
                    key={run.id}
                    href={`/history/${run.id}`}
                    className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[#0b0f18] p-4 transition hover:border-sky-400/35 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {run.title ?? run.accountName}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {run.workflowName} · {run.salespersonName}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-xs text-sky-300">{run.model}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {new Date(run.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <div className="space-y-6">
              <section className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.055] p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                  Quick start
                </p>
                <h2 className="mt-4 text-xl font-semibold">
                  General Intelligence
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Talk directly to Gemma or begin a structured learning session
                  around anything you want to understand.
                </p>
                <Link
                  href="/workflows/general-intelligence"
                  className="mt-6 inline-flex rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-black hover:bg-emerald-400"
                >
                  Open workflow
                </Link>
              </section>

              <section className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.035] p-6">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Privacy status
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  Kai Studio processes every prompt locally. GitHub metadata and
                  README files sync only from repositories you own.
                </p>
                <p className="mt-4 text-xs text-slate-600">
                  Cloud tokens used: 0
                </p>
              </section>
            </div>
          </div>

          {latestRun && (
            <p className="mt-6 text-xs text-slate-600">
              Last run saved {new Date(latestRun.createdAt).toLocaleString()}.
            </p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function displayModel(model: string) {
  if (model.includes("12b")) return "Gemma 4 12B";
  if (model.includes("26b")) return "Gemma 4 26B";
  if (model.includes("31b")) return "Gemma 4 31B";
  return model;
}

function StatCard({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-white/10 bg-white/[0.025] p-5 transition hover:-translate-y-0.5 hover:border-sky-400/35 hover:bg-sky-400/[0.035]"
    >
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-600">{detail}</p>
        <span className="text-xs text-sky-400 opacity-0 transition group-hover:opacity-100">
          Open →
        </span>
      </div>
    </Link>
  );
}
