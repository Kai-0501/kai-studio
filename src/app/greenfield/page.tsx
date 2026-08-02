"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";

type Template = { id: string; displayName: string; description: string };
export default function GreenfieldPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [root, setRoot] = useState("");
  const [templateId, setTemplateId] = useState("nextjs");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { void fetch("/api/greenfield/templates").then((response) => response.json()).then((body: { templates?: Template[]; root?: string }) => { setTemplates(body.templates ?? []); setRoot(body.root ?? ""); }); }, []);
  async function scaffold() {
    setMessage("Preparing local scaffold…");
    const response = await fetch("/api/greenfield/scaffold", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root, templateId, projectName: name, confirmed: true }) });
    const body = await response.json() as { projectRoot?: string; error?: string };
    setMessage(response.ok ? `Created ${body.projectRoot}. Review the plan before asking an agent to edit it.` : body.error || "Scaffold failed.");
  }
  return <AppShell><section className="mx-auto w-full max-w-4xl p-8"><Link href="/" aria-label="Back to Kai Studio dashboard" className="inline-flex rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:border-sky-400 hover:text-sky-300">← Back to Dashboard</Link><p className="mt-8 text-xs font-semibold uppercase tracking-[0.24em] text-sky-400">Greenfield workspace</p><h1 className="mt-3 text-4xl font-semibold">Create a new local application</h1><p className="mt-3 text-slate-400">Choose an approved template and create a disposable local project. Nothing is published or deployed.</p><div className="mt-8 grid gap-4 md:grid-cols-3">{templates.map((template) => <button type="button" key={template.id} onClick={() => setTemplateId(template.id)} className={`rounded-2xl border p-5 text-left ${templateId === template.id ? "border-sky-400 bg-sky-400/10" : "border-slate-800 bg-slate-950/40"}`}><p className="font-medium">{template.displayName}</p><p className="mt-2 text-sm text-slate-400">{template.description}</p></button>)}</div><div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/40 p-5"><label className="block text-sm text-slate-300">Project name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="my-local-app" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-sky-400" /></label><button type="button" onClick={scaffold} disabled={!name.trim()} className="mt-5 rounded-xl bg-sky-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-40">Create local scaffold</button>{message ? <p className="mt-4 text-sm text-slate-400">{message}</p> : null}</div></section></AppShell>;
}
