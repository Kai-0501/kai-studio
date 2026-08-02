"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import type { KaiAgentPlan } from "@/lib/kai-agent-plan";

export default function KaiAgentPage() {
  const [target, setTarget] = useState("greenfield:my-local-app");
  const [task, setTask] = useState("");
  const [plan, setPlan] = useState<KaiAgentPlan | null>(null);
  const [status, setStatus] = useState("");
  const [approved, setApproved] = useState(false);
  async function createPlan() {
    setStatus("Building an implementation plan…");
    const [kind, ...parts] = target.split(":");
    const response = await fetch("/api/kai-agent/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, target: { kind, value: parts.join(":") } }) });
    const body = await response.json() as { plan?: KaiAgentPlan; error?: string };
    setPlan(body.plan ?? null); setStatus(response.ok ? "Plan ready for your review. Coding has not started." : body.error ?? "Plan failed.");
  }
  async function approvePlan() {
    if (!plan) return;
    setStatus("Starting the durable coding session…");
    const [kind, ...parts] = target.split(":");
    const response = await fetch("/api/kai-agent/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, task, target: { kind, value: parts.join(":") } }) });
    const body = await response.json() as { href?: string; error?: string };
    if (!response.ok || !body.href) { setStatus(body.error ?? "Kai Agent could not start the coding session."); return; }
    setApproved(true);
    window.location.assign(body.href);
  }
  return <AppShell><section className="flex-1 px-6 py-12 sm:px-10 lg:px-14"><div className="mx-auto max-w-5xl"><Link href="/" className="text-sm text-slate-400 hover:text-sky-300">← Dashboard</Link><p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-sky-400">Kai Agent</p><h1 className="mt-3 text-4xl font-semibold">Turn an idea into a reviewed implementation</h1><p className="mt-3 max-w-2xl text-slate-400">Describe a feature or new application. Kai Studio will structure the work first; coding starts only after you approve the plan.</p><div className="mt-8 grid gap-5 rounded-2xl border border-white/10 bg-white/[0.02] p-6"><label className="text-sm text-slate-300">Target<select value={target} onChange={(event) => setTarget(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3"><option value="greenfield:my-local-app">Greenfield Workspace · my-local-app</option><option value="repository:owner/repository">Approved repository · owner/repository</option></select></label><label className="text-sm text-slate-300">What should Kai Agent build?<textarea value={task} onChange={(event) => setTask(event.target.value)} rows={7} placeholder="Describe the bounded feature or app…" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3" /></label><button type="button" onClick={() => void createPlan()} disabled={!task.trim()} className="w-fit rounded-xl bg-sky-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-40">Create implementation plan</button>{status && <p className="text-sm text-slate-400">{status}</p>}</div>{plan && <div className="mt-6 rounded-2xl border border-sky-400/30 bg-sky-400/[0.04] p-6"><h2 className="text-xl font-semibold">Implementation plan</h2><p className="mt-3 text-slate-300">{plan.objective}</p>{(["scope","nonGoals","constraints","phases","verification","securityBoundaries","acceptanceCriteria","stopConditions"] as const).map((key) => <div key={key} className="mt-5"><h3 className="font-medium capitalize text-sky-300">{key.replace(/([A-Z])/g, " $1")}</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">{plan[key].map((item) => <li key={item}>{item}</li>)}</ul></div>)}<button type="button" onClick={() => void approvePlan()} disabled={approved || target.startsWith("greenfield:")} className="mt-6 rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40">Approve and start coding</button></div>}</div></section></AppShell>;
}
