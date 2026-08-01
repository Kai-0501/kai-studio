"use client";

import { useState } from "react";

const modelOptions = [
  { value: "gemma4:12b-mlx", label: "Gemma 4 12B" },
  { value: "gemma4:26b-mlx", label: "Gemma 4 26B" },
  { value: "gemma4:31b-mlx", label: "Gemma 4 31B" },
  { value: "hf:gemma4-26b-a4b-q4", label: "Gemma 4 26B A4B · Hugging Face" },
];

export function ResponseActions({
  content,
  currentModel,
  disabled = false,
  onRegenerate,
}: {
  content: string;
  currentModel: string;
  disabled?: boolean;
  onRegenerate: (model: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [showModels, setShowModels] = useState(false);

  async function copyResponse() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1 pl-11">
      <button
        type="button"
        onClick={copyResponse}
        disabled={disabled}
        className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition hover:bg-sky-400/10 hover:text-sky-200 disabled:opacity-40"
        aria-label="Copy response"
      >
        {copied ? "✓ Copied" : "⧉ Copy"}
      </button>
      <button
        type="button"
        onClick={() => void onRegenerate(currentModel)}
        disabled={disabled}
        className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition hover:bg-sky-400/10 hover:text-sky-200 disabled:opacity-40"
        aria-label="Regenerate response"
      >
        ↻ Regenerate
      </button>
      <button
        type="button"
        onClick={() => setShowModels((current) => !current)}
        disabled={disabled}
        className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition hover:bg-sky-400/10 hover:text-sky-200 disabled:opacity-40"
        aria-expanded={showModels}
      >
        ◇ Use another model
      </button>
      {showModels && (
        <div className="flex flex-wrap gap-1 rounded-xl border border-sky-400/15 bg-sky-400/[0.06] p-1 backdrop-blur-md">
          {modelOptions
            .filter((option) => option.value !== currentModel)
            .map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setShowModels(false);
                  void onRegenerate(option.value);
                }}
                className="rounded-lg px-2.5 py-1.5 text-xs text-sky-200 transition hover:bg-sky-400/15"
              >
                {option.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
