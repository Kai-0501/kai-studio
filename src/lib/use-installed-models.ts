"use client";

import { useEffect, useState } from "react";
import type { ModelAssignments, SystemStatus } from "@/types/settings";

export type InstalledModelOption = { value: string; label: string };

export function localModelLabel(name: string) {
  if (name.startsWith("hf:")) return `${name.slice(3).replaceAll("-", " ")} · Hugging Face`;
  return name.replace(/:latest$/, "").replaceAll("-", " ");
}

export function useInstalledModels(
  assignment: keyof ModelAssignments,
  fallback: string,
) {
  const [options, setOptions] = useState<InstalledModelOption[]>([
    { value: fallback, label: localModelLabel(fallback) },
  ]);
  const [assignedModel, setAssignedModel] = useState(fallback);
  const [selectedModel, setSelectedModel] = useState(fallback);

  useEffect(() => {
    const refresh = () => Promise.all([fetch("/api/system/status"), fetch("/api/settings")])
      .then(async ([statusResponse, settingsResponse]) => {
        const status = (await statusResponse.json()) as SystemStatus;
        const settings = (await settingsResponse.json()) as {
          modelAssignments?: ModelAssignments;
        };
        const discovered = [...status.models, ...(status.huggingFaceModels ?? [])]
          .map((model) => ({ value: model.name, label: localModelLabel(model.name) }))
          .filter((model, index, all) => all.findIndex((candidate) => candidate.value === model.value) === index);
        const selected = settings.modelAssignments?.[assignment] ?? fallback;
        setAssignedModel(selected);
        setSelectedModel(selected);
        setOptions(
          discovered.some((model) => model.value === selected)
            ? discovered
            : [{ value: selected, label: localModelLabel(selected) }, ...discovered],
        );
      })
      .catch(() => undefined);
    void refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [assignment, fallback]);

  return { options, assignedModel, selectedModel, setSelectedModel };
}
