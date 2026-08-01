"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import type { DiagnosticsJob } from "@/lib/diagnostics-jobs";

export default function DiagnosticsProgressPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<DiagnosticsJob | null>(null);
  useEffect(() => {
    let active = true;
    const check = async () => {
      const response = await fetch(`/api/diagnostics/${id}`, { cache: "no-store" });
      if (!response.ok || !active) return;
      const next = await response.json() as DiagnosticsJob;
      setJob(next);
      if (next.status === "complete" && next.runId) router.replace(`/history/${next.runId}`);
    };
    void check();
    const timer = window.setInterval(check, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [id, router]);
  return <AppShell><main className="flex flex-1 items-center justify-center px-6"><section className="w-full max-w-2xl rounded-3xl border border-sky-400/20 bg-sky-400/[0.035] p-8"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">Diagnostics running</p><h1 className="mt-4 text-3xl font-semibold">Kai Studio is checking itself.</h1><div className="mt-8 space-y-3">{(job?.progress ?? ["Starting the diagnostic."]).map((item, index) => <div key={index} className="flex gap-3 text-sm text-slate-300"><span className={index === (job?.progress.length ?? 1) - 1 ? "text-sky-300 animate-pulse" : "text-emerald-300"}>{index === (job?.progress.length ?? 1) - 1 ? "●" : "✓"}</span><span>{item}</span></div>)}</div>{job?.status === "failed" && <p className="mt-6 rounded-xl bg-red-400/10 p-4 text-sm text-red-300">{job.error}</p>}</section></main></AppShell>;
}
