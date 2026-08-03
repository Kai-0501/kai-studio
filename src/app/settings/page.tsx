"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import type {
  KaiStudioSettings,
  ModelAssignments,
  SystemStatus,
} from "@/types/settings";
import type { KaiMemoryStatus } from "@/types/memory";
import type { GenerationPerformance } from "@/types/performance";
import { DashboardBackLink } from "@/components/dashboard-back-link";
import { ModelRoleHelp } from "@/components/model-role-help";
import { defaultModelAssignments, modelRoleDescription } from "@/lib/models/roles";

export default function SettingsPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [defaultModel, setDefaultModel] = useState("gemma4:12b-mlx");
  const [modelAssignments, setModelAssignments] = useState<ModelAssignments>(defaultModelAssignments);
  const [longTermMemoryEnabled, setLongTermMemoryEnabled] = useState(true);
  const [memoryDebugEnabled, setMemoryDebugEnabled] = useState(false);
  const [codingContextLimit, setCodingContextLimit] = useState<16384 | 32768>(32768);
  const [codingBudgetOverrideMinutes, setCodingBudgetOverrideMinutes] = useState<number | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [memory, setMemory] = useState<KaiMemoryStatus | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memorySource, setMemorySource] = useState("");
  const [memoryMessage, setMemoryMessage] = useState("");
  const [savingMemory, setSavingMemory] = useState(false);
  const [performance, setPerformance] = useState<GenerationPerformance[]>([]);
  const [modelSearchRoots, setModelSearchRoots] = useState<string[]>([]);
  const [embeddingRuntime, setEmbeddingRuntime] = useState<KaiStudioSettings["embeddingRuntime"] | null>(null);
  const [modelRootDraft, setModelRootDraft] = useState("");
  const [validatingModel, setValidatingModel] = useState<string | null>(null);
  const [retrieval, setRetrieval] = useState<{ kaiLore: { model: string; status: string; message: string; generation?: { dimensions?: number; model_revision?: string } | null }; coding: { model: string; status: string; message: string; hybridEnabled: boolean; reranker: string } } | null>(null);
  const [reindexing, setReindexing] = useState(false);

  const availableModels = allModels(status);

  async function checkSystem() {
    setChecking(true);
    setMessage("");

    try {
      const [statusResponse, settingsResponse, memoryResponse, performanceResponse, retrievalResponse] = await Promise.all([
        fetch("/api/system/status"),
        fetch("/api/settings"),
        fetch("/api/memory"),
        fetch("/api/performance"),
        fetch("/api/retrieval/status"),
      ]);
      const systemStatus = (await statusResponse.json()) as SystemStatus;
      const settings =
        (await settingsResponse.json()) as KaiStudioSettings;
      setStatus(systemStatus);
      setDefaultModel(settings.defaultModel);
      setModelAssignments(settings.modelAssignments);
      setLongTermMemoryEnabled(settings.longTermMemoryEnabled);
      setMemoryDebugEnabled(settings.memoryDebugEnabled);
      setCodingContextLimit(settings.codingContextLimit);
      setCodingBudgetOverrideMinutes(settings.codingBudgetOverrideMinutes);
      setModelSearchRoots(settings.modelSearchRoots ?? []);
      setEmbeddingRuntime(settings.embeddingRuntime);
      const currentMemory = (await memoryResponse.json()) as KaiMemoryStatus;
      setMemory(currentMemory);
      setMemoryDraft(currentMemory.content);
      setMemorySource(currentMemory.sourceName ?? "");
      setPerformance(
        (await performanceResponse.json()) as GenerationPerformance[],
      );
      setRetrieval(await retrievalResponse.json());
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/system/status"),
      fetch("/api/settings"),
      fetch("/api/memory"),
      fetch("/api/performance"),
      fetch("/api/retrieval/status"),
    ])
      .then(async ([statusResponse, settingsResponse, memoryResponse, performanceResponse, retrievalResponse]) => {
        const systemStatus = (await statusResponse.json()) as SystemStatus;
        const settings =
          (await settingsResponse.json()) as KaiStudioSettings;
        setStatus(systemStatus);
        setDefaultModel(settings.defaultModel);
        setModelAssignments(settings.modelAssignments);
        setLongTermMemoryEnabled(settings.longTermMemoryEnabled);
        setMemoryDebugEnabled(settings.memoryDebugEnabled);
        setCodingContextLimit(settings.codingContextLimit);
        setCodingBudgetOverrideMinutes(settings.codingBudgetOverrideMinutes);
        setModelSearchRoots(settings.modelSearchRoots ?? []);
        setEmbeddingRuntime(settings.embeddingRuntime);
        const currentMemory = (await memoryResponse.json()) as KaiMemoryStatus;
        setMemory(currentMemory);
        setMemoryDraft(currentMemory.content);
        setMemorySource(currentMemory.sourceName ?? "");
        setPerformance(
          (await performanceResponse.json()) as GenerationPerformance[],
        );
        setRetrieval(await retrievalResponse.json());
      })
      .finally(() => setChecking(false));
  }, []);

  async function saveDefault() {
    setSaving(true);
    setMessage("");

    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultModel,
        modelAssignments,
        longTermMemoryEnabled,
        memoryDebugEnabled,
        codingContextLimit,
        codingBudgetOverrideMinutes,
        modelSearchRoots,
        ...(embeddingRuntime ? { embeddingRuntime } : {}),
      }),
    });

    setMessage(response.ok ? "Model settings saved ✓" : "Could not save settings.");
    setSaving(false);
  }

  function addModelRoot() {
    const root = modelRootDraft.trim();
    if (!root || modelSearchRoots.includes(root)) return;
    if (root === "/" || root === "~" || root.endsWith("/.git")) {
      setMessage("Choose a dedicated model folder, not your whole home folder or a Git directory.");
      return;
    }
    setModelSearchRoots((current) => [...current, root]);
    setModelRootDraft("");
    setMessage("Save model folders, then check connection to rescan.");
  }

  async function validateModel(model: string) {
    setValidatingModel(model);
    setMessage("");
    try {
      const response = await fetch("/api/system/models/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const result = (await response.json()) as { error?: string };
      setMessage(response.ok ? "Local runtime validation completed ✓" : result.error ?? "This model could not be validated.");
      await checkSystem();
    } finally {
      setValidatingModel(null);
    }
  }

  async function reindexKaiLore() {
    setReindexing(true);
    setMessage("");
    try {
      const response = await fetch("/api/retrieval/reindex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: "kailore" }) });
      setMessage(response.ok ? "KaiLore reindex completed ✓" : "KaiLore reindex could not start.");
      const statusResponse = await fetch("/api/retrieval/status");
      setRetrieval(await statusResponse.json());
    } finally { setReindexing(false); }
  }

  async function importMemoryFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      setMemoryDraft(content);
      setMemorySource(file.name);
      setMemoryMessage(`${file.name} is ready to import.`);
    } catch {
      setMemoryMessage("Kai Studio could not read that file.");
    } finally {
      event.target.value = "";
    }
  }

  async function saveMemory() {
    setSavingMemory(true);
    setMemoryMessage("");

    try {
      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: memoryDraft,
          sourceName: memorySource || "Pasted weekly memory",
        }),
      });
      const result = (await response.json()) as KaiMemoryStatus & {
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "Could not save memory.");

      setMemory(result);
      setMemoryDraft(result.content);
      setMemorySource(result.sourceName ?? "");
      setMemoryMessage("Weekly memory updated ✓");
    } catch (failure) {
      setMemoryMessage(
        failure instanceof Error ? failure.message : "Could not save memory.",
      );
    } finally {
      setSavingMemory(false);
    }
  }

  async function clearMemory() {
    if (
      !window.confirm(
        "Remove Kai Studio's current memory? Existing chat history will remain.",
      )
    ) {
      return;
    }

    const response = await fetch("/api/memory", { method: "DELETE" });
    if (!response.ok) {
      setMemoryMessage("Could not remove memory.");
      return;
    }

    const result = (await response.json()) as KaiMemoryStatus;
    setMemory(result);
    setMemoryDraft("");
    setMemorySource("");
    setMemoryMessage("Memory removed.");
  }

  return (
    <AppShell>
      <section className="flex-1 px-6 py-12 sm:px-10 lg:px-14">
        <div className="mx-auto max-w-5xl">
          <DashboardBackLink />
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-400">
            Settings
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            Local AI system
          </h1>
          <p className="mt-3 text-slate-400">
            Review local AI connectivity and choose Kai Studio&apos;s default model.
          </p>

          <section className="mt-10 rounded-2xl border border-white/10 bg-white/[0.025] p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      checking
                        ? "animate-pulse bg-amber-400"
                        : status?.ollamaOnline || availableModels.length
                          ? "bg-emerald-400"
                          : "bg-red-400"
                    }`}
                  />
                  <h2 className="font-semibold">
                    {checking
                      ? "Checking local models…"
                      : status?.ollamaOnline || availableModels.length
                        ? "Local models are ready"
                        : "Local models are unavailable"}
                  </h2>
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  Kai Studio manages compatible runtimes automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={checkSystem}
                disabled={checking}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 transition hover:border-sky-400/40 hover:text-white disabled:opacity-50"
              >
                Check connection
              </button>
            </div>

            {!checking && !status?.ollamaOnline && availableModels.length === 0 && (
              <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300">
                Kai Studio could not find an available local model runtime.
              </p>
            )}
          </section>

          <section
            id="performance"
            className="mt-6 scroll-mt-6 rounded-2xl border border-sky-400/20 bg-sky-400/[0.035] p-6"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-semibold">Chat performance</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Exact local generation speed for saved normal chats.
                </p>
              </div>
              <p className="text-xs text-slate-500">
                Temporary chats are not recorded
              </p>
            </div>

            {performance.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-white/10 p-8 text-center">
                <p className="text-sm text-slate-400">
                  Complete a normal Chat response to record its speed.
                </p>
              </div>
            ) : (
              <div className="mt-6 overflow-hidden rounded-xl border border-white/10">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-white/10 bg-[#0b0f18] px-4 py-3 text-xs text-slate-500 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_9rem]">
                  <span>Chat</span>
                  <span className="hidden sm:block">Model</span>
                  <span className="text-right">Speed</span>
                  <span className="hidden text-right sm:block">Generated</span>
                </div>
                {performance.map((record) => (
                  <article
                    key={record.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-white/[0.06] px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_9rem]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-300">
                        {record.label}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {new Date(record.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="hidden self-center text-xs text-slate-500 sm:block">
                      {displayName(record.model).split(" · ")[0]}
                    </span>
                    <span className="self-center text-right text-sm font-medium text-sky-300">
                      {record.tokensPerSecond.toFixed(1)} tok/s
                    </span>
                    <span className="hidden self-center text-right text-xs text-slate-500 sm:block">
                      {record.generatedTokens.toLocaleString()} tokens ·{" "}
                      {record.durationSeconds.toFixed(1)}s
                    </span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] p-6">
            <div>
              <h2 className="font-semibold">Installed local models</h2>
              <p className="mt-1 text-sm text-slate-500">
                Discovered from Ollama, Kai-managed runtimes, approved local folders, and the Hugging Face cache. Discovery does not claim a model can run until its runtime validates it.
              </p>
            </div>

            <div className="mt-6 grid gap-3">
              {availableModels.map((model) => (
                <label
                  key={model.name}
                  className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-4 transition ${
                    defaultModel === model.name
                      ? "border-sky-400/50 bg-sky-500/10"
                      : "border-white/10 bg-[#0b0f18] hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="defaultModel"
                      value={model.name}
                      checked={defaultModel === model.name}
                      onChange={() => {
                        setDefaultModel(model.name);
                        setMessage("");
                      }}
                      className="accent-sky-500"
                    />
                    <div>
                      <p className="text-sm font-medium">{model.displayName ?? displayName(model.name)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {modelOwnershipLabel(model)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs ${isRunnableModel(model) ? "text-emerald-300" : "text-amber-300"}`}>{isRunnableModel(model) ? "Available" : "Discovered candidate"}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {formatBytes(model.size)}
                    </p>
                    {!isRunnableModel(model) && model.runtime === "llama.cpp" ? <button type="button" onClick={(event) => { event.preventDefault(); void validateModel(model.name); }} disabled={validatingModel === model.name} className="mt-2 text-xs text-sky-300 hover:text-sky-200 disabled:opacity-50">{validatingModel === model.name ? "Validating…" : "Validate runtime"}</button> : null}
                  </div>
                </label>
              ))}

              {!checking && availableModels.length === 0 && (
                <p className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-500">
                  No Kai Studio-compatible local models were found.
                </p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-6">
              <p className="text-sm text-emerald-300">{message}</p>
              <button
                type="button"
                onClick={saveDefault}
                disabled={saving || availableModels.length === 0}
                className="rounded-xl border border-sky-400/25 bg-sky-400/15 px-5 py-3 text-sm font-medium text-sky-200 hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save default"}
              </button>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-sky-400/20 bg-sky-400/[0.035] p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold">Retrieval indexes</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">KaiLore and coding retrieval have separate model assignments, vector dimensions, and index generations. Changing one never silently changes the other.</p>
              </div>
              <button type="button" onClick={reindexKaiLore} disabled={reindexing} className="rounded-xl border border-sky-400/25 bg-sky-400/15 px-4 py-2.5 text-sm font-medium text-sky-200 hover:bg-sky-400/25 disabled:opacity-40">{reindexing ? "Reindexing…" : "Reindex KaiLore"}</button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-[#0b0f18] p-4">
                <p className="text-sm font-medium">KaiLore Embedding</p>
                <p className="mt-2 text-sm text-sky-200">{retrieval?.kaiLore.model ?? modelAssignments.kaiLoreEmbedding}</p>
                <p className="mt-2 text-xs text-slate-500">{retrieval?.kaiLore.message ?? "Checking index status…"}</p>
                <p className="mt-2 text-xs text-slate-600">{retrieval?.kaiLore.generation ? `Dimension ${retrieval.kaiLore.generation.dimensions ?? "unknown"} · active generation` : "No active generation"}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0b0f18] p-4">
                <p className="text-sm font-medium">Coding Embedding</p>
                <p className="mt-2 text-sm text-sky-200">{retrieval?.coding.model ?? modelAssignments.codingEmbedding}</p>
                <p className="mt-2 text-xs text-slate-500">{retrieval?.coding.message ?? "Checking index status…"}</p>
                <p className="mt-2 text-xs text-slate-600">Hybrid retrieval {retrieval?.coding.hybridEnabled ? "enabled" : "unavailable"} · Reranker: {retrieval?.coding.reranker ?? "not configured"}</p>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-sky-400/20 bg-sky-400/[0.035] p-6">
            <h2 className="font-semibold">Embedding runtime lifecycle</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Embedding runtimes load only when their workflow needs them, stay warm briefly for nearby work, and unload independently without touching chat or coding models.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {(["kaiLore", "coding"] as const).map((domain) => {
                const policy = embeddingRuntime?.[domain];
                if (!policy) return null;
                return <div key={domain} className="rounded-xl border border-white/10 bg-[#0b0f18] p-4">
                  <p className="text-sm font-medium">{domain === "kaiLore" ? "KaiLore Embedding" : "Coding Embedding"}</p>
                  <label className="mt-3 block text-xs text-slate-500">Idle retention (seconds)
                    <input type="number" min={30} max={900} value={policy.idleTimeoutSeconds} onChange={(event) => setEmbeddingRuntime((current) => current ? { ...current, [domain]: { ...current[domain], idleTimeoutSeconds: Math.min(900, Math.max(30, Number(event.target.value) || 30)) } } : current)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111620] px-3 py-2 text-sm text-slate-200" />
                  </label>
                  <p className="mt-3 text-xs text-slate-500">{domain === "coding" ? "Retained across planner, implementer, and reviewer transitions." : "Retained while indexing and reindexing."}</p>
                </div>;
              })}
            </div>
            <div className="mt-5 flex justify-end border-t border-white/10 pt-5"><button type="button" onClick={saveDefault} disabled={saving || !embeddingRuntime} className="rounded-xl border border-sky-400/25 bg-sky-400/15 px-5 py-2.5 text-sm font-medium text-sky-200 hover:bg-sky-400/25 disabled:opacity-40">{saving ? "Saving…" : "Save runtime settings"}</button></div>
          </section>

          <section className="mt-6 rounded-2xl border border-sky-400/20 bg-sky-400/[0.035] p-6">
            <div>
              <h2 className="font-semibold">Model assignments <span className="text-xs font-normal text-slate-500">Hover or focus a ? to see what a role does.</span></h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                Choose which installed model powers each part of Kai Studio. Coding assignments inherit the complete bounded coding toolbelt automatically; security remains a separate review role.
              </p>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {(Object.keys(modelAssignments) as Array<keyof ModelAssignments>).map((key) => (
                <label key={key} className="rounded-xl border border-white/10 bg-[#0b0f18] p-4">
                  <span className="flex items-center text-sm font-medium">{modelRoleDescription(key).label}<ModelRoleHelp role={modelRoleDescription(key)} /></span>
                  <select
                    value={modelAssignments[key]}
                    onChange={(event) => { setModelAssignments((current) => ({ ...current, [key]: event.target.value })); setMessage(""); }}
                    className="mt-3 w-full rounded-lg border border-white/10 bg-[#111620] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-sky-400/40"
                  >
                    {!availableModels.some((model) => model.name === modelAssignments[key]) && modelAssignments[key] ? <option value={modelAssignments[key]}>{displayName(modelAssignments[key])} · unavailable</option> : null}
                    {availableModels.map((model) => <option key={`${key}-${model.name}`} value={model.name}>{model.displayName ?? displayName(model.name)}{!isRunnableModel(model) ? " · needs validation" : ""}</option>)}
                  </select>
                  {!availableModels.some((model) => model.name === modelAssignments[key] && (model.status === "available" || model.provider === "ollama")) ? <span className="mt-2 block text-xs text-amber-300">Assigned model is unavailable or has not passed runtime validation. Save is preserved, but execution will show a clear warning.</span> : null}
                </label>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-5">
              <p className="text-xs text-slate-500">Model selections remain saved even when a model is temporarily unavailable. Kai Studio never silently substitutes a different assignment.</p>
              <button type="button" onClick={saveDefault} disabled={saving} className="rounded-xl border border-sky-400/25 bg-sky-400/15 px-5 py-2.5 text-sm font-medium text-sky-200 hover:bg-sky-400/25 disabled:opacity-40">{saving ? "Saving…" : "Save assignments"}</button>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-sky-400/20 bg-sky-400/[0.035] p-6">
            <h2 className="font-semibold">Local model folders</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Kai Studio scans only approved folders: your Models folder, its own managed folders, the Hugging Face cache, and folders you add here. It never scans your entire home folder.</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <input value={modelRootDraft} onChange={(event) => setModelRootDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addModelRoot(); } }} placeholder="Paste a local model folder path" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0b0f18] px-4 py-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-400/40" />
              <button type="button" onClick={addModelRoot} className="rounded-xl border border-sky-400/25 bg-sky-400/15 px-4 py-3 text-sm font-medium text-sky-200 hover:bg-sky-400/25">Register folder</button>
            </div>
            <div className="mt-4 grid gap-2">
              {modelSearchRoots.length ? modelSearchRoots.map((root) => <div key={root} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0b0f18] px-4 py-3 text-sm"><span className="min-w-0 truncate text-slate-300">{root}</span><button type="button" onClick={() => setModelSearchRoots((current) => current.filter((candidate) => candidate !== root))} className="text-xs text-slate-500 hover:text-red-300">Remove</button></div>) : <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">No extra folders registered. This is optional; standard approved locations are always scanned.</p>}
            </div>
            <div className="mt-5 flex justify-end border-t border-white/10 pt-5"><button type="button" onClick={saveDefault} disabled={saving} className="rounded-xl border border-sky-400/25 bg-sky-400/15 px-5 py-2.5 text-sm font-medium text-sky-200 hover:bg-sky-400/25 disabled:opacity-40">{saving ? "Saving…" : "Save folders"}</button></div>
          </section>

          <section className="mt-6 rounded-2xl border border-sky-400/20 bg-sky-400/[0.035] p-6">
            <h2 className="font-semibold">Coding session capacity</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Choose the private context size used by each logical coding agent and optionally override the task-aware initial time budget.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="rounded-xl border border-white/10 bg-[#0b0f18] p-4">
                <span className="block text-sm font-medium">Agent context</span>
                <select value={codingContextLimit} onChange={(event) => setCodingContextLimit(Number(event.target.value) as 16384 | 32768)} className="mt-3 w-full rounded-lg border border-white/10 bg-[#111620] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-sky-400/40">
                  <option value={16384}>16K · lower memory use</option>
                  <option value={32768}>32K · deeper repository work</option>
                </select>
              </label>
              <label className="rounded-xl border border-white/10 bg-[#0b0f18] p-4">
                <span className="block text-sm font-medium">Initial time budget</span>
                <input type="number" min={5} max={180} value={codingBudgetOverrideMinutes ?? ""} onChange={(event) => setCodingBudgetOverrideMinutes(event.target.value ? Number(event.target.value) : null)} placeholder="Automatic by task type" className="mt-3 w-full rounded-lg border border-white/10 bg-[#111620] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-sky-400/40" />
                <span className="mt-2 block text-xs text-slate-500">Leave blank for the task-aware 15–60 minute policy.</span>
              </label>
            </div>
            <div className="mt-5 flex justify-end border-t border-white/10 pt-5"><button type="button" onClick={saveDefault} disabled={saving} className="rounded-xl border border-sky-400/25 bg-sky-400/15 px-5 py-2.5 text-sm font-medium text-sky-200 hover:bg-sky-400/25 disabled:opacity-40">{saving ? "Saving…" : "Save coding capacity"}</button></div>
          </section>

          <section className="mt-6 rounded-2xl border border-violet-400/20 bg-violet-400/[0.035] p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">
                Developer preview
              </p>
              <h2 className="mt-2 font-semibold">Tiered KaiLore memory</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Keep the KaiLore corpus and index on disk, then inject only a
                small set of memories selected for the current conversation.
                Enabling this replaces whole-file weekly memory injection.
              </p>
            </div>
            <div className="mt-5 grid gap-3">
              <label className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#0b0f18] p-4">
                <span>
                  <span className="block text-sm font-medium">Enable tiered memory</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    Reads KaiLore from the app data directory.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={longTermMemoryEnabled}
                  onChange={(event) => setLongTermMemoryEnabled(event.target.checked)}
                  className="h-4 w-4 accent-violet-500"
                />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#0b0f18] p-4">
                <span>
                  <span className="block text-sm font-medium">Memory diagnostics</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    Allows the local debug endpoint to show retrieval provenance.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={memoryDebugEnabled}
                  onChange={(event) => setMemoryDebugEnabled(event.target.checked)}
                  className="h-4 w-4 accent-violet-500"
                />
              </label>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-sky-400/20 bg-sky-400/[0.035] p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      memory?.active ? "bg-sky-400" : "bg-slate-600"
                    }`}
                  />
                  <h2 className="font-semibold">Kai Memory</h2>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  Stored locally on this Mac. Use this editor to import or update
                  the memory context that normal Chat can use.
                </p>
              </div>
              <div className="shrink-0 text-left text-xs text-slate-500 sm:text-right">
                <p>{memory?.active ? "Active in normal Chat" : "No memory loaded"}</p>
                {memory?.updatedAt && (
                  <p className="mt-1">
                    Updated {new Date(memory.updatedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <label className="cursor-pointer rounded-xl border border-sky-400/25 bg-sky-400/10 px-4 py-2.5 text-sm text-sky-200 transition hover:bg-sky-400/20">
                Choose memory file
                <input
                  type="file"
                  accept=".md,.txt,.json,text/markdown,text/plain,application/json"
                  onChange={importMemoryFile}
                  className="hidden"
                />
              </label>
              <span className="text-xs text-slate-500">
                Markdown, text, or JSON · replaces the previous version
              </span>
            </div>

            <label className="mt-5 block">
              <span className="text-sm font-medium text-slate-300">
                Current local memory
              </span>
              <textarea
                value={memoryDraft}
                onChange={(event) => {
                  setMemoryDraft(event.target.value);
                  setMemorySource("Pasted weekly memory");
                  setMemoryMessage("");
                }}
                rows={12}
                placeholder="Paste the memory export from ChatGPT here…"
                className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-[#0b0f18] px-4 py-3 text-sm leading-6 text-slate-300 outline-none transition placeholder:text-slate-600 focus:border-sky-400/40"
              />
            </label>

            <div className="mt-4 flex flex-col gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-500">
                <p>
                  {memoryDraft.trim()
                    ? `${memoryDraft.trim().split(/\s+/).length.toLocaleString()} words ready`
                    : "Nothing imported yet"}
                </p>
                {memoryMessage && (
                  <p className="mt-1 text-sky-300">{memoryMessage}</p>
                )}
              </div>
              <div className="flex gap-3">
                {memory?.active && (
                  <button
                    type="button"
                    onClick={clearMemory}
                    className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-400 transition hover:border-red-400/30 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  onClick={saveMemory}
                  disabled={savingMemory || !memoryDraft.trim()}
                  className="rounded-xl border border-sky-400/25 bg-sky-400/15 px-5 py-2.5 text-sm font-medium text-sky-200 transition hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {savingMemory ? "Updating…" : "Save manual override"}
                </button>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.035] p-6">
            <h2 className="text-sm font-medium text-emerald-300">
              Privacy guarantee
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Chats, workflow inputs, saved runs, model outputs, and memory remain
              local unless you explicitly enable a separate integration.
            </p>
          </section>
        </div>
      </section>
    </AppShell>
  );
}

function displayName(model: string) {
  const clean = model.replace(/^hf:/, "").replace(/:latest$/, "").replaceAll("-", " ");
  return model.startsWith("hf:") ? `${clean} · Hugging Face` : clean;
}

function allModels(status: SystemStatus | null) {
  const candidates = [...(status?.models ?? []), ...(status?.discoveredModels ?? []), ...(status?.huggingFaceModels ?? [])];
  return [...new Map(candidates.map((model) => [model.name, model])).values()];
}

function modelOwnershipLabel(model: NonNullable<SystemStatus>["models"][number]) {
  if (model.provider === "ollama") return "Ollama · locally managed";
  const source = model.source?.replaceAll("-", " ") ?? "local folder";
  const ownership = model.ownership === "kai-managed" ? "Kai Studio managed" : model.ownership === "manual" ? "Manually registered" : "User managed";
  return `${ownership} · ${source}`;
}

function isRunnableModel(model: NonNullable<SystemStatus>["models"][number]) {
  return model.provider === "ollama" || model.status === "available";
}

function formatBytes(bytes: number) {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
