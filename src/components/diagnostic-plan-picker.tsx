"use client";

import { useState } from "react";
import type { DiagnosticPriority, DiagnosticRecommendation, SavedRun } from "@/types/run";

const groups: { priority: DiagnosticPriority; label: string }[] = [
  { priority: "critical", label: "Critical priority" },
  { priority: "high", label: "High priority" },
  { priority: "medium", label: "Medium priority" },
  { priority: "low", label: "Low priority" },
  { priority: "user-request", label: "User requests" },
];

export function DiagnosticPlanPicker({ run }: { run: SavedRun }) {
  const [open, setOpen] = useState(false);
  const [recommendations, setRecommendations] = useState<DiagnosticRecommendation[]>(run.diagnosticsRecommendations ?? []);
  const [selected, setSelected] = useState<Set<string>>(new Set(run.diagnosticSelectedRecommendationIds ?? []));
  const [customRequest, setCustomRequest] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function showPicker() {
    setOpen(true);
    if (recommendations.length) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(run.id)}/recommendations`, { cache: "no-store" });
      const body = (await response.json()) as { recommendations?: DiagnosticRecommendation[]; error?: string };
      if (!response.ok || !body.recommendations?.length) throw new Error(body.error || "Could not organise the diagnostics report.");
      setRecommendations(body.recommendations);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not organise the diagnostics report.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function sendSelected() {
    if ((!selected.size && !customRequest.trim()) || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(run.id)}/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIds: [...selected], customRequest }),
      });
      const body = (await response.json()) as { href?: string; error?: string };
      if (!response.ok || !body.href) throw new Error(body.error || "Could not prepare the selected plan.");
      window.location.assign(body.href);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not prepare the selected plan.");
      setSending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={showPicker} className="mt-4 ml-11 inline-flex rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-sky-300">
        Build selected plan with the coding agent →
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="diagnostics-plan-title">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-sky-400/30 bg-[#0d121c] p-7 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-400">Diagnostics plan</p>
                <h2 id="diagnostics-plan-title" className="mt-2 text-2xl font-semibold text-white">What would you like to implement?</h2>
                <p className="mt-2 text-sm text-slate-400">Only the items you select will be orchestrated and handed directly to Qwen.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-sky-400/50">Close</button>
            </div>

            {loading ? <p className="mt-8 animate-pulse text-slate-400">Organising recommendations…</p> : (
              <div className="mt-7 space-y-7">
                {groups.map((group) => {
                  const items = recommendations.filter((item) => item.priority === group.priority);
                  if (!items.length) return null;
                  return <section key={group.priority}>
                    <h3 className="mb-3 text-sm font-semibold text-sky-300">{group.label}</h3>
                    <div className="space-y-3">
                      {items.map((item) => (
                        <label key={item.id} className="flex cursor-pointer gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 hover:border-sky-400/40">
                          <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="mt-1 h-4 w-4 accent-sky-400" />
                          <span><span className="block font-medium text-slate-100">{item.title}</span><span className="mt-1 block text-sm leading-6 text-slate-400">{item.summary}</span></span>
                        </label>
                      ))}
                    </div>
                  </section>;
                })}
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-sky-300">User request</h3>
                  <textarea value={customRequest} onChange={(event) => setCustomRequest(event.target.value)} placeholder="Add something you want implemented that was not in the report…" className="min-h-28 w-full rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-400/60" />
                </section>
              </div>
            )}
            {error && <p className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
            <div className="mt-7 flex justify-end">
              <button type="button" onClick={sendSelected} disabled={loading || sending || (!selected.size && !customRequest.trim())} className="rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40">
                {sending ? "Preparing selected plan…" : "Send selected to coding agent"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
