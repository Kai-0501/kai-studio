"use client";

import { FormEvent, useState } from "react";
import { FollowUpChat } from "@/components/follow-up-chat";
import { MarkdownResponse } from "@/components/markdown-response";
import { useInstalledModels } from "@/lib/use-installed-models";

type AccountForm = {
  companyName: string;
  companyWebsite: string;
  targetPersona: string;
  productName: string;
  productDescription: string;
  salesObjective: string;
  research: string;
};

type CopyStatus = "idle" | "copied" | "failed";

const initialForm: AccountForm = {
  companyName: "",
  companyWebsite: "",
  targetPersona: "",
  productName: "",
  productDescription: "",
  salesObjective: "Prepare for a discovery meeting",
  research: "",
};

function buildAccountPrompt(values: AccountForm) {
  return `# ROLE
You are a rigorous B2B account research and sales strategy analyst. You convert supplied research into actionable account intelligence without presenting assumptions as facts.

# OBJECTIVE
Prepare account intelligence for ${values.companyName} to help pursue the following sales objective: ${values.salesObjective}.

# SELLER CONTEXT
Target account: ${values.companyName}
Company website identifier: ${values.companyWebsite || "Not supplied"}
Target persona or role: ${values.targetPersona}
Product or service: ${values.productName}
Product description:
${values.productDescription}

# SUPPLIED RESEARCH
<research_sources>
${values.research}
</research_sources>

# EVIDENCE POLICY
- Treat only information inside <research_sources> as verified source material.
- The company website field is an identifier only. You cannot browse it and must not claim to have done so.
- Clearly separate "Source-grounded finding" from "Sales hypothesis".
- Attach a short evidence note to every source-grounded finding.
- Assign each hypothesis a confidence of Low, Medium, or High based on the supplied evidence.
- Never invent financial figures, initiatives, technologies, employees, customers, events, quotations, or stakeholder names.
- Write "Not supported by supplied research" whenever evidence is missing.

# REQUIRED DELIVERABLES
Return the following sections using these exact Markdown headings:

## 1. Account Overview
Summarise what the supplied research establishes about the company, its business, and its current context.

## 2. Strategic Priorities
List apparent priorities supported by the research. For each priority include:
- Source-grounded finding
- Evidence
- Relevance to the target persona

## 3. Pain Hypotheses
Use a Markdown table with the columns:
Pain hypothesis | Supporting evidence | Confidence | Question to validate

Hypotheses must be framed as possibilities to investigate, not established facts.

## 4. Stakeholder Map
Identify only named stakeholders or roles supported by the research. Use:
Stakeholder or role | Likely relevance | Evidence | Unknowns

## 5. Discovery Questions
Produce 10 prioritised, open-ended questions tailored to ${values.targetPersona}. Each question must connect to a finding, hypothesis, or explicit information gap.

## 6. Outreach Angles
Develop 3 concise outreach angles. For each include:
- Relevant trigger or context
- Value hypothesis connecting ${values.productName} to the account
- Suggested opening message
- Evidence limitation

## 7. Risks and Unsupported Assumptions
List research gaps, weak inferences, competing explanations, timing risks, and claims that require validation.

## 8. Recommended Next Steps
Recommend a short sequence of research and sales actions appropriate for: ${values.salesObjective}.

# PRODUCT RELEVANCE RULES
- Do not force a product fit where the research does not support one.
- Do not claim that ${values.productName} solves a problem unless framed as a hypothesis.
- Keep product messaging specific to the supplied product description.
- Prefer useful discovery questions over confident but unsupported recommendations.

# FINAL QUALITY CHECK
Before responding, silently verify that:
1. Every factual claim is traceable to the supplied research.
2. Every inference is labelled as a hypothesis.
3. Missing information remains visibly missing.
4. No stakeholder, initiative, metric, or technology was invented.
5. All eight deliverables are present in the required order.

Return only the completed account intelligence deliverables in Markdown.`;
}

async function copyText(text: string) {
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error();
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

export function AccountIntelligenceRunner() {
  const { options: modelOptions, selectedModel: model, setSelectedModel: setModel } = useInstalledModels("account", "gemma4:26b-mlx");
  const [values, setValues] = useState<AccountForm>(initialForm);
  const [sourceMode, setSourceMode] = useState<"text" | "pdf">("text");
  const [compiledPrompt, setCompiledPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [formError, setFormError] = useState("");
  const [runError, setRunError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [savedRunId, setSavedRunId] = useState("");
  const [pdfStatus, setPdfStatus] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [extractingPdf, setExtractingPdf] = useState(false);
  const [outputCopy, setOutputCopy] = useState<CopyStatus>("idle");

  function updateField(field: keyof AccountForm, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFormError("");
  }

  async function extractPdf(file: File | undefined) {
    if (!file) return;
    setExtractingPdf(true);
    setPdfError("");
    setPdfStatus(`Reading ${file.name}…`);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/extract-pdf", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        text?: string;
        fileName?: string;
        pageCount?: number;
        truncated?: boolean;
        error?: string;
      };

      if (!response.ok || !result.text) {
        throw new Error(result.error || "Kai Studio could not read this PDF.");
      }

      updateField("research", result.text);
      setPdfStatus(
        `${result.fileName} · ${result.pageCount} page${
          result.pageCount === 1 ? "" : "s"
        } extracted${result.truncated ? " · text limit reached" : ""} ✓`,
      );
    } catch (failure) {
      setPdfStatus("");
      setPdfError(
        failure instanceof Error
          ? failure.message
          : "Kai Studio could not read this PDF.",
      );
    } finally {
      setExtractingPdf(false);
    }
  }

  async function submitWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const required = [
      values.companyName,
      values.targetPersona,
      values.productName,
      values.productDescription,
      values.research,
    ];

    if (required.some((value) => !value.trim())) {
      setFormError(
        "Complete the company, target persona, product context, and research.",
      );
      return;
    }

    const cleaned = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim()]),
    ) as AccountForm;
    const prompt = buildAccountPrompt(cleaned);
    setCompiledPrompt(prompt);
    setOutput("");
    setRunError("");
    setSaveStatus("");
    setSavedRunId("");
    setOutputCopy("idle");
    await runGemma(prompt);
  }

  async function runGemma(prompt: string) {
    setIsRunning(true);
    setOutput("");
    setRunError("");
    setSaveStatus("");
    let completeOutput = "";

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Gemma could not analyse this account.");
      }
      if (!response.body) throw new Error("Gemma returned an empty response.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        completeOutput += text;
        setOutput((current) => current + text);
      }

      const saveResponse = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId: "account-intelligence",
          inputLabel: "Supplied account research",
          accountName: values.companyName.trim(),
          salespersonName: values.targetPersona.trim(),
          transcript: values.research.trim(),
          compiledPrompt: prompt,
          model,
          output: completeOutput,
        }),
      });

      if (saveResponse.ok) {
        const savedRun = (await saveResponse.json()) as { id: string };
        setSavedRunId(savedRun.id);
        setSaveStatus("Saved to History ✓");
      } else {
        setSaveStatus("Analysis completed, but History could not save it.");
      }
    } catch (failure) {
      setRunError(
        failure instanceof Error
          ? failure.message
          : "Gemma could not analyse this account.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function handleCopy(
    text: string,
    setter: (status: CopyStatus) => void,
  ) {
    setter((await copyText(text)) ? "copied" : "failed");
  }

  return (
    <div className="mt-10 space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <form
          onSubmit={submitWorkflow}
          className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.025] p-6 sm:p-8"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Company name">
              <input
                value={values.companyName}
                onChange={(event) =>
                  updateField("companyName", event.target.value)
                }
                placeholder="e.g. Dell Technologies"
                className={inputClass}
              />
            </Field>
            <Field label="Company website (optional)">
              <input
                value={values.companyWebsite}
                onChange={(event) =>
                  updateField("companyWebsite", event.target.value)
                }
                placeholder="e.g. dell.com"
                className={inputClass}
              />
            </Field>
            <Field label="Target persona or role">
              <input
                value={values.targetPersona}
                onChange={(event) =>
                  updateField("targetPersona", event.target.value)
                }
                placeholder="e.g. VP of Sales Operations"
                className={inputClass}
              />
            </Field>
            <Field label="Product or service">
              <input
                value={values.productName}
                onChange={(event) =>
                  updateField("productName", event.target.value)
                }
                placeholder="e.g. Sovereign AI platform"
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Product description">
            <textarea
              rows={3}
              value={values.productDescription}
              onChange={(event) =>
                updateField("productDescription", event.target.value)
              }
              placeholder="Describe what you sell, who it helps, and the value it creates."
              className={`${inputClass} resize-y leading-6`}
            />
          </Field>

          <Field label="Sales objective">
            <select
              value={values.salesObjective}
              onChange={(event) =>
                updateField("salesObjective", event.target.value)
              }
              className={inputClass}
            >
              <option>Prepare for a discovery meeting</option>
              <option>Develop an outbound prospecting angle</option>
              <option>Build an account plan</option>
              <option>Prepare an executive account brief</option>
              <option>Identify research gaps and next steps</option>
            </select>
          </Field>

          <div>
            <span className="text-sm font-medium">Account research</span>
            <div className="mt-2 grid grid-cols-2 rounded-xl border border-white/10 bg-[#0b0f18] p-1">
              <SourceButton
                active={sourceMode === "text"}
                onClick={() => setSourceMode("text")}
              >
                Paste research
              </SourceButton>
              <SourceButton
                active={sourceMode === "pdf"}
                onClick={() => setSourceMode("pdf")}
              >
                Upload PDF
              </SourceButton>
            </div>
          </div>

          {sourceMode === "pdf" && (
            <div className="rounded-xl border border-dashed border-amber-400/25 bg-amber-500/[0.035] p-5">
              <label className="flex cursor-pointer flex-col items-center text-center">
                <span className="text-2xl text-amber-300">⇧</span>
                <span className="mt-2 text-sm font-medium">
                  Choose a research PDF
                </span>
                <span className="mt-1 text-xs text-slate-500">
                  Annual report, briefing, or company document · maximum 20 MB
                </span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={extractingPdf}
                  onChange={(event) =>
                    void extractPdf(event.target.files?.[0])
                  }
                  className="mt-4 block max-w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-500 file:px-3 file:py-2 file:text-xs file:font-medium file:text-black"
                />
              </label>
              {pdfStatus && (
                <p className="mt-3 text-center text-xs text-emerald-300">
                  {pdfStatus}
                </p>
              )}
              {pdfError && (
                <p className="mt-3 rounded-lg bg-red-400/10 px-3 py-2 text-xs text-red-300">
                  {pdfError}
                </p>
              )}
            </div>
          )}

          <Field
            label={
              sourceMode === "pdf"
                ? "Extracted research (editable)"
                : "Research notes and source text"
            }
          >
            <textarea
              rows={15}
              value={values.research}
              onChange={(event) =>
                updateField("research", event.target.value)
              }
              placeholder={
                sourceMode === "pdf"
                  ? "Extracted PDF text will appear here..."
                  : "Paste annual-report excerpts, company notes, news, or other sourced research..."
              }
              className={`${inputClass} resize-y leading-6`}
            />
          </Field>

          {formError && (
            <p className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300">
              {formError}
            </p>
          )}

          <div className="flex items-center justify-between border-t border-white/10 pt-6">
            <p className="text-xs text-slate-500">
              Research remains on this Mac.
            </p>
            <button
              disabled={isRunning}
              className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-40"
            >
              {isRunning ? "Analysing…" : "Run Account Intelligence"}
            </button>
          </div>
        </form>

        <section className="flex min-h-[40rem] flex-col rounded-2xl border border-amber-400/20 bg-amber-500/[0.025] p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Account Intelligence response</p>
              <p className="mt-1 text-xs text-slate-500">
                Generated locally by {model}
              </p>
              {saveStatus && (
                <p className="mt-2 text-xs text-emerald-400">{saveStatus}</p>
              )}
            </div>
            {output && !isRunning && (
              <button
                type="button"
                onClick={() => handleCopy(output, setOutputCopy)}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:text-white"
              >
                {copyLabel(outputCopy, "Copy output")}
              </button>
            )}
          </div>

          <div className="mt-5 border-y border-white/10 py-5">
            <label className="space-y-2">
              <span className="block text-xs font-medium text-slate-400">
                Local model
              </span>
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={isRunning}
                className="w-full rounded-xl border border-white/10 bg-[#080b12] px-4 py-3 text-sm outline-none focus:border-amber-400/60"
              >
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {runError && (
            <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300">
              {runError}
            </p>
          )}

          {isRunning || output ? (
            <MarkdownResponse className="mt-5 max-h-[55rem] flex-1">
              {output || "Loading the account analyst…"}
            </MarkdownResponse>
          ) : (
            <div className="flex flex-1 items-center justify-center text-center">
              <div>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300">
                  ◇
                </div>
                <p className="mt-4 text-sm font-medium text-slate-300">
                  Gemma’s account analysis will appear here
                </p>
                <p className="mt-2 max-w-xs text-xs leading-5 text-slate-600">
                  Supply sourced research and run the workflow. Its structured
                  instruction stays behind the scenes.
                </p>
              </div>
            </div>
          )}

          {output && !isRunning && (
            <div className="mt-6">
              <FollowUpChat
                compiledPrompt={compiledPrompt}
                initialOutput={output}
                model={model}
                runId={savedRunId || undefined}
                accent="amber"
                embedded
                suggestions={[
                  `Prioritise the three strongest pain hypotheses for ${values.targetPersona || "this persona"}.`,
                  `Turn the discovery questions for ${values.companyName || "this account"} into a 30-minute call plan.`,
                  `Draft a personalised outreach angle connecting ${values.productName || "our product"} to the strongest evidence.`,
                ]}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-[#0b0f18] px-4 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-amber-400/60";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function SourceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2.5 text-sm transition ${
        active
          ? "bg-amber-500/15 text-amber-300"
          : "text-slate-500 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function copyLabel(status: CopyStatus, defaultLabel: string) {
  if (status === "copied") return "Copied ✓";
  if (status === "failed") return "Copy failed";
  return defaultLabel;
}
