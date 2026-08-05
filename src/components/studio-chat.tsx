"use client";

import {
  ChangeEvent,
  Fragment,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { MarkdownResponse } from "@/components/markdown-response";
import { ResponseActions } from "@/components/response-actions";
import {
  filesToImageAttachments,
  imagePayload,
  MAX_IMAGES,
  type ImageAttachment,
} from "@/lib/image-attachments";
import type { FollowUpMessage } from "@/types/run";
import type { KaiMemoryStatus } from "@/types/memory";
import type { CodingRuntimeSnapshot } from "@/lib/coding-runtime";
import Link from "next/link";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: ImageAttachment[];
  generatedImage?: string;
  imageGeneration?: { id: string; status: "complete" | "unverified"; stages: string[]; attempts: Array<{ number: number; status: string; review?: { score: number; overallNotes: string }; compiledPrompt?: string; provider?: string; model?: string }>; intent?: { subject?: string; requirements?: Array<{ id: string; description: string; importance: string }> } };
};

type ComposerMode = "chat" | "image";

type AudioCapture = {
  context: AudioContext;
  processor: ScriptProcessorNode;
  silentOutput: GainNode;
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
  samples: Float32Array[];
  sampleRate: number;
};

const MAX_RECORDING_SECONDS = 30;

const fallbackModelOptions = [
  { value: "gemma4:12b-mlx", label: "Gemma 4 12B", detail: "Quick" },
  { value: "gemma4:26b-mlx", label: "Gemma 4 26B", detail: "Balanced" },
  { value: "gemma4:31b-mlx", label: "Gemma 4 31B", detail: "Deep" },
];

export function StudioChat({
  initialPrompt = "",
  repositoryHandoff,
  autoStart = false,
  activeBuildJobId,
  diagnosticRunId,
}: {
  initialPrompt?: string;
  repositoryHandoff?: { owner: string; repo: string; fullName: string };
  autoStart?: boolean;
  activeBuildJobId?: string;
  diagnosticRunId?: string;
} = {}) {
  const [model, setModel] = useState("gemma4:26b-mlx");
  const [modelOptions, setModelOptions] = useState(fallbackModelOptions);
  const [longTermMemoryEnabled, setLongTermMemoryEnabled] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState(initialPrompt);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [imageErrorTechnical, setImageErrorTechnical] = useState<{
    requestId?: string;
    stage?: string;
    provider?: string;
    errorClass?: string;
    retryAvailable?: boolean;
    suggestedAction?: string;
    metadata?: Record<string, string | number | boolean | undefined>;
  } | null>(null);
  const [runId, setRunId] = useState("");
  const [memoryStatus, setMemoryStatus] = useState<KaiMemoryStatus | null>(null);
  const [isTemporary, setIsTemporary] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [buildProgress, setBuildProgress] = useState<string[]>([]);
  const [pendingBuildId, setPendingBuildId] = useState("");
  const [reviewedBuildId, setReviewedBuildId] = useState("");
  const [isApplyingBuild, setIsApplyingBuild] = useState(false);
  const [activeLoopState, setActiveLoopState] = useState<{ jobId: string; stepCount: number; inspectionCount: number; stepLimit: number; extensionCount: number; awaitingExtension: boolean; elapsedMinutes: number; executionBudgetMinutes: number; automaticExtensionMinutes: number; userExtensionMinutes: number; awaitingTimeDecision: boolean; latestMeaningfulProgress: string; currentPhase: string; currentAgent: string; currentRole: string; contextUtilization: number; currentRepositoryRevision: string; activeReservations: string[]; pendingHandoffs: number; currentBlockers: string[]; resourceWarning: string } | null>(null);
  const [codingRuntimeState, setCodingRuntimeState] = useState<CodingRuntimeSnapshot | null>(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(true);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const applyBuildButtonRef = useRef<HTMLButtonElement>(null);
  const autoStartTriggeredRef = useRef(false);
  const resumedBuildRef = useRef("");
  const shouldAutoFollowRef = useRef(true);
  const sessionIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    const refreshModels = () => Promise.all([fetch("/api/settings"), fetch("/api/system/status")])
      .then(async ([settingsResponse, statusResponse]) => {
        const settings = await settingsResponse.json() as {
          defaultModel?: string;
          modelAssignments?: { chat?: string; coding?: string };
          longTermMemoryEnabled?: boolean;
        };
        const status = await statusResponse.json() as { models?: Array<{ name: string; displayName?: string; provider?: string; status?: string }>; discoveredModels?: Array<{ name: string; displayName?: string; provider?: string; status?: string }>; huggingFaceModels?: Array<{ name: string; displayName?: string; provider?: string; status?: string }> };
        const installed = [...(status.models ?? []), ...(status.discoveredModels ?? []), ...(status.huggingFaceModels ?? [])]
          .filter((item, index, all) => all.findIndex((candidate) => candidate.name === item.name) === index)
          .map((item) => ({ value: item.name, label: item.displayName ?? modelLabel(item.name), detail: item.provider === "ollama" ? "Ollama" : item.status === "available" ? "Local runtime" : "Local candidate" }));
        if (installed.length) setModelOptions(installed);
        const preferred = repositoryHandoff
          ? settings.modelAssignments?.coding
          : settings.modelAssignments?.chat ?? settings.defaultModel;
        if (preferred) setModel(preferred);
        setLongTermMemoryEnabled(settings.longTermMemoryEnabled === true);
      })
      .catch(() => {
        // Keep 26B as the balanced chat default.
      });
    void refreshModels();
    window.addEventListener("focus", refreshModels);
    const timer = window.setInterval(refreshModels, 30_000);
    return () => {
      window.removeEventListener("focus", refreshModels);
      window.clearInterval(timer);
    };
  }, [repositoryHandoff]);

  useEffect(() => {
    fetch("/api/memory")
      .then((response) => response.json() as Promise<KaiMemoryStatus>)
      .then(setMemoryStatus)
      .catch(() => setMemoryStatus(null));
  }, []);

  useEffect(() => {
    const updateVisibility = () => setIsDocumentVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (!autoStart || autoStartTriggeredRef.current) return;
    autoStartTriggeredRef.current = true;
    const timer = window.setTimeout(() => composerFormRef.current?.requestSubmit(), 50);
    return () => window.clearTimeout(timer);
  }, [autoStart]);

  useEffect(() => {
    if (!autoStart || !pendingBuildId || isRunning || isApplyingBuild) return;
    const frame = requestAnimationFrame(() => applyBuildButtonRef.current?.click());
    return () => cancelAnimationFrame(frame);
  }, [autoStart, pendingBuildId, isRunning, isApplyingBuild]);

  useEffect(() => {
    if (!shouldAutoFollowRef.current) return;

    const frame = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [messages, isRunning]);

  useEffect(
    () => () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      const capture = audioCaptureRef.current;
      capture?.processor.disconnect();
      capture?.silentOutput.disconnect();
      capture?.source.disconnect();
      capture?.stream.getTracks().forEach((track) => track.stop());
      void capture?.context.close();
    },
    [],
  );

  function handleConversationScroll() {
    const container = scrollContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoFollowRef.current = distanceFromBottom < 120;
  }

  function startNewChat() {
    if (isRunning || isRecording || isTranscribing) return;
    setMessages([]);
    setDraft("");
    setImages([]);
    setError("");
    setImageErrorTechnical(null);
    setRunId("");
    shouldAutoFollowRef.current = true;
    sessionIdRef.current = crypto.randomUUID();
  }

  function toggleTemporaryChat() {
    if (isRunning || isRecording || isTranscribing) return;
    setIsTemporary((current) => !current);
    setMessages([]);
    setDraft("");
    setImages([]);
    setError("");
    setRunId("");
    shouldAutoFollowRef.current = true;
    sessionIdRef.current = crypto.randomUUID();
  }

  function mergeSamples(chunks: Float32Array[]) {
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const merged = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  function resampleTo16Khz(samples: Float32Array, sourceRate: number) {
    if (sourceRate === 16_000) return samples;
    const ratio = sourceRate / 16_000;
    const length = Math.round(samples.length / ratio);
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const start = Math.floor(index * ratio);
      const end = Math.min(Math.floor((index + 1) * ratio), samples.length);
      let sum = 0;
      for (let cursor = start; cursor < end; cursor += 1) sum += samples[cursor];
      output[index] = sum / Math.max(1, end - start);
    }
    return output;
  }

  function encodeWav(samples: Float32Array) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeText = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };

    writeText(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16_000, true);
    view.setUint32(28, 32_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, samples.length * 2, true);

    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(
        44 + index * 2,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
    }
    return new Uint8Array(buffer);
  }

  function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function finishRecording() {
    const capture = audioCaptureRef.current;
    if (!capture) return;
    audioCaptureRef.current = null;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    capture.processor.disconnect();
    capture.silentOutput.disconnect();
    capture.source.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    await capture.context.close();
    setIsRecording(false);
    setIsTranscribing(true);
    setError("");

    try {
      const samples = resampleTo16Khz(
        mergeSamples(capture.samples),
        capture.sampleRate,
      );
      if (samples.length < 4_000) {
        throw new Error("That recording was too short. Please try again.");
      }
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: bytesToBase64(encodeWav(samples)) }),
      });
      const body = (await response.json()) as {
        transcript?: string;
        error?: string;
      };
      if (!response.ok || !body.transcript) {
        throw new Error(body.error || "That recording could not be transcribed.");
      }
      setDraft((current) =>
        current.trim() ? `${current.trim()}\n\n${body.transcript}` : body.transcript!,
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "That recording could not be transcribed.",
      );
    } finally {
      setIsTranscribing(false);
      setRecordingSeconds(0);
    }
  }

  async function startRecording() {
    if (
      isRunning ||
      isTranscribing ||
      composerMode !== "chat" ||
      audioCaptureRef.current
    ) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      const samples: Float32Array[] = [];
      processor.onaudioprocess = (event) => {
        samples.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silentOutput);
      silentOutput.connect(context.destination);
      audioCaptureRef.current = {
        context,
        processor,
        silentOutput,
        source,
        stream,
        samples,
        sampleRate: context.sampleRate,
      };
      setError("");
      setRecordingSeconds(0);
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((current) => {
          const next = current + 1;
          if (next >= MAX_RECORDING_SECONDS) void finishRecording();
          return next;
        });
      }, 1_000);
    } catch {
      setError(
        "Microphone access was not granted. Allow Kai Studio to use the microphone in System Settings, then try again.",
      );
    }
  }

  async function addImages(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;
    try {
      const added = await filesToImageAttachments(
        event.target.files,
        images.length,
      );
      setImages((current) => [...current, ...added]);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not add that photo.",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = draft.trim();
    if ((!content && images.length === 0) || isRunning) return;

    const userContent =
      content || "Please examine the attached image and tell me what you see.";
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userContent,
      images,
    };
    const conversationBeforeAnswer = [...messages, userMessage];
    const assistantId = crypto.randomUUID();

    shouldAutoFollowRef.current = true;
    setMessages([
      ...conversationBeforeAnswer,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setDraft("");
    setImages([]);
    setError("");
    setIsRunning(true);

    let completeAnswer = "";

    try {
      if (repositoryHandoff && composerMode === "chat") {
        setBuildProgress([]);
        setPendingBuildId("");
        const response = await fetch("/api/github/build/active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner: repositoryHandoff.owner, repo: repositoryHandoff.repo, task: userContent, ...(diagnosticRunId ? { diagnosticRunId } : {}) }) });
        const body = (await response.json()) as { id?: string; error?: string };
        if (!response.ok || !body.id) throw new Error(body.error || "The repository build could not start.");
        await followActiveBuild(body.id, false, conversationBeforeAnswer, assistantId);
        return;
      }

      if (composerMode === "image") {
        const response = await fetch("/api/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: userContent }),
        });
        const body = (await response.json()) as {
          image?: string;
          error?: string;
          technical?: {
            requestId?: string;
            stage?: string;
            provider?: string;
            errorClass?: string;
            retryAvailable?: boolean;
            suggestedAction?: string;
            metadata?: Record<string, string | number | boolean | undefined>;
          };
          id?: string;
          status?: "complete" | "unverified";
          stages?: string[];
          attempts?: ChatMessage["imageGeneration"] extends infer Details ? Details extends { attempts: infer Attempts } ? Attempts : never : never;
          intent?: ChatMessage["imageGeneration"] extends infer Details ? Details extends { intent: infer Intent } ? Intent : never : never;
        };
        if (!response.ok || !body.image) {
          setImageErrorTechnical(body.technical ?? null);
          throw new Error(body.error || "Kai Studio could not create that image.");
        }

        setMessages([
          ...conversationBeforeAnswer,
          {
            id: assistantId,
            role: "assistant",
            content: body.status === "unverified" ? "Created locally. Visual review was unavailable, so this candidate is marked unverified." : "Created locally after checking the requested requirements.",
            generatedImage: body.image,
            imageGeneration: body.id && body.status ? { id: body.id, status: body.status, stages: body.stages ?? [], attempts: body.attempts ?? [], intent: body.intent } : undefined,
          },
        ]);
        return;
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          trackPerformance: !isTemporary,
          performanceLabel: userContent,
          useMemory: !longTermMemoryEnabled,
          useLongTermMemory: longTermMemoryEnabled,
          memorySessionId: sessionIdRef.current,
          messages: conversationBeforeAnswer.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.images?.length
              ? { images: imagePayload(message.images) }
              : {}),
          })),
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Gemma could not answer.");
      }
      if (!response.body) throw new Error("Gemma returned an empty response.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        completeAnswer += decoder.decode(value, { stream: true });
        setMessages([
          ...conversationBeforeAnswer,
          { id: assistantId, role: "assistant", content: completeAnswer },
        ]);
      }

      if (!isTemporary && !runId && messages.length === 0) {
        const saveResponse = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowId: "general-intelligence",
            inputLabel: "Chat",
            accountName: userContent.slice(0, 72),
            salespersonName: "Chat",
            transcript: userContent,
            compiledPrompt: userContent,
            model,
            output: completeAnswer,
          }),
        });
        if (saveResponse.ok) {
          const saved = (await saveResponse.json()) as { id: string };
          setRunId(saved.id);
        }
      } else if (!isTemporary && runId) {
        const followUps: FollowUpMessage[] = [
          ...conversationBeforeAnswer.slice(2).map((message) => ({
            role: message.role,
            content: message.content,
            createdAt: new Date().toISOString(),
          })),
          {
            role: "assistant",
            content: completeAnswer,
            createdAt: new Date().toISOString(),
          },
        ];
        await fetch(`/api/runs/${runId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ followUps }),
        });
      }
    } catch (failure) {
      setBuildProgress([]);
      setMessages(conversationBeforeAnswer);
      setError(
        failure instanceof Error ? failure.message : "Gemma could not answer.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function followActiveBuild(
    jobId: string,
    resume: boolean,
    existingConversation?: ChatMessage[],
    existingAssistantId?: string,
  ) {
    setIsRunning(true);
    setError("");
    let conversation = existingConversation;
    let assistantId = existingAssistantId;
    while (true) {
      const response = await fetch(`/api/github/build/active?id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const job = (await response.json()) as {
        task?: string;
        status?: "running" | "complete" | "failed";
        error?: string;
        events?: Array<{ type: "progress" | "final" | "error"; message?: string; content?: string; error?: string; readyToPush?: boolean; buildId?: string }>;
        implementationStepCount?: number; inspectionCount?: number; stepLimit?: number; extensionCount?: number; awaitingExtension?: boolean; elapsedMinutes?: number; executionBudgetMinutes?: number; automaticExtensionMinutes?: number; userExtensionMinutes?: number; awaitingTimeDecision?: boolean; latestMeaningfulProgress?: string; currentPhase?: string; currentAgent?: string; currentRole?: string; contextUtilization?: number; currentRepositoryRevision?: string; activeReservations?: string[]; pendingHandoffs?: number; currentBlockers?: string[]; resourceWarning?: string; codingRuntime?: CodingRuntimeSnapshot;
      };
      if (!response.ok) throw new Error(job.error || "The active build session could not be reopened.");
      if (resume && !conversation) {
        conversation = [{ id: crypto.randomUUID(), role: "user", content: job.task || "Implement the repository plan." }];
        assistantId = crypto.randomUUID();
        setMessages([...conversation, { id: assistantId, role: "assistant", content: "" }]);
      }
      const events = job.events ?? [];
      setActiveLoopState({ jobId, stepCount: job.implementationStepCount ?? 0, inspectionCount: job.inspectionCount ?? 0, stepLimit: job.stepLimit ?? 150, extensionCount: job.extensionCount ?? 0, awaitingExtension: job.awaitingExtension === true, elapsedMinutes: job.elapsedMinutes ?? 0, executionBudgetMinutes: job.executionBudgetMinutes ?? 0, automaticExtensionMinutes: job.automaticExtensionMinutes ?? 0, userExtensionMinutes: job.userExtensionMinutes ?? 0, awaitingTimeDecision: job.awaitingTimeDecision === true, latestMeaningfulProgress: job.latestMeaningfulProgress ?? "Preparing the coding session.", currentPhase: job.currentPhase ?? "Implementation", currentAgent: job.currentAgent ?? "implementer-1", currentRole: job.currentRole ?? "implementer", contextUtilization: job.contextUtilization ?? 0, currentRepositoryRevision: job.currentRepositoryRevision ?? "", activeReservations: job.activeReservations ?? [], pendingHandoffs: job.pendingHandoffs ?? 0, currentBlockers: job.currentBlockers ?? [], resourceWarning: job.resourceWarning ?? "" });
      setCodingRuntimeState(job.codingRuntime ?? null);
      const progress = events.filter((event) => event.type === "progress" && event.message).map((event) => event.message!);
      const finalEvent = [...events].reverse().find((event) => event.type === "final");
      const errorEvent = [...events].reverse().find((event) => event.type === "error");
      setBuildProgress(progress.slice(-8));
      if (errorEvent || job.status === "failed") throw new Error(errorEvent?.error || "The secure build failed.");
      if (finalEvent && job.status === "complete") {
        const finalContent = finalEvent.content || "The secure build finished.";
        setMessages([...(conversation ?? []), { id: assistantId ?? crypto.randomUUID(), role: "assistant", content: finalContent }]);
        setBuildProgress([]);
        if (finalEvent.readyToPush && finalEvent.buildId) setReviewedBuildId(finalEvent.buildId);
        setIsRunning(false);
        setActiveLoopState(null);
        setCodingRuntimeState(null);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }
  }

  async function decideActiveLoop(decision: "extend" | "stop" | "time_extend_15" | "time_extend_30" | "time_stop" | "cancel") {
    if (!activeLoopState) return;
    await fetch("/api/github/build/active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: activeLoopState.jobId, decision }) });
    if (decision === "stop" || decision === "time_stop" || decision === "cancel") setActiveLoopState(null);
    if (decision === "stop" || decision === "time_stop" || decision === "cancel") setCodingRuntimeState(null);
  }

  useEffect(() => {
    if (!activeBuildJobId || resumedBuildRef.current === activeBuildJobId) return;
    resumedBuildRef.current = activeBuildJobId;
    void followActiveBuild(activeBuildJobId, true).catch((failure) => {
      setBuildProgress([]);
      setIsRunning(false);
      setError(failure instanceof Error ? failure.message : "The active build session could not be reopened.");
    });
  }, [activeBuildJobId]);

  async function applyPendingBuild() {
    if (!pendingBuildId || isApplyingBuild) return;
    setIsApplyingBuild(true); setError(""); setBuildProgress([]);
    try {
      const response = await fetch("/api/github/build/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buildId: pendingBuildId }) });
      if (!response.ok || !response.body) throw new Error("The iterative coding run could not start.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let finalContent = "";
      let nextBuildId = "";
      let readyToPush = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n"); pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const update = JSON.parse(line) as { type: "progress" | "final" | "error"; message?: string; content?: string; error?: string; readyToPush?: boolean; buildId?: string; codingRuntime?: CodingRuntimeSnapshot };
          if (update.codingRuntime) setCodingRuntimeState(update.codingRuntime);
          if (update.type === "progress" && update.message) setBuildProgress((current) => [...current.slice(-7), update.message!]);
          if (update.type === "error") throw new Error(update.error || "The iterative coding run failed.");
          if (update.type === "final") { finalContent = update.content ?? "The iterative build finished."; nextBuildId = update.buildId ?? ""; readyToPush = update.readyToPush === true; }
        }
      }
      if (!finalContent) throw new Error("The coding agent stopped without a completion report.");
      setMessages((current) => current.map((message, index) => index === current.length - 1 && message.role === "assistant" ? { ...message, content: `${message.content}\n\n${finalContent}` } : message));
      setPendingBuildId("");
      if (readyToPush && nextBuildId) setReviewedBuildId(nextBuildId);
      setCodingRuntimeState(null);
    } catch (failure) { setCodingRuntimeState(null); setError(failure instanceof Error ? failure.message : "The iterative coding run failed."); }
    finally { setBuildProgress([]); setIsApplyingBuild(false); }
  }

  async function pushReviewedBuild() {
    if (!reviewedBuildId || isApplyingBuild) return;
    setIsApplyingBuild(true); setError("");
    try {
      const response = await fetch("/api/github/build/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buildId: reviewedBuildId }) });
      const body = (await response.json()) as { message?: string; error?: string; url?: string };
      if (!response.ok) throw new Error(body.error || "The reviewed branch could not be pushed.");
      setMessages((current) => current.map((message, index) => index === current.length - 1 && message.role === "assistant" ? { ...message, content: `${message.content}\n\n✅ ${body.message}${body.url ? `\n\n[Open draft pull request](${body.url})` : ""}` } : message));
      setReviewedBuildId("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The reviewed branch could not be pushed."); }
    finally { setIsApplyingBuild(false); }
  }

  async function regenerateLastResponse(nextModel: string) {
    if (isRunning) return;
    const assistantIndex = messages.findLastIndex(
      (message) => message.role === "assistant",
    );
    if (assistantIndex < 0) return;

    const previousMessages = messages;
    const context = messages.slice(0, assistantIndex);
    const assistantId = messages[assistantIndex].id;
    setModel(nextModel);
    setError("");
    setIsRunning(true);
    shouldAutoFollowRef.current = false;
    setMessages([
      ...context,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    let completeAnswer = "";

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: nextModel,
          trackPerformance: !isTemporary,
          performanceLabel: context[0]?.content ?? "Regenerated chat response",
          useMemory: !longTermMemoryEnabled,
          useLongTermMemory: longTermMemoryEnabled,
          memorySessionId: sessionIdRef.current,
          messages: context.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.images?.length
              ? { images: imagePayload(message.images) }
              : {}),
          })),
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Kai Studio could not regenerate that reply.");
      }
      if (!response.body) throw new Error("Kai Studio returned an empty response.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        completeAnswer += decoder.decode(value, { stream: true });
        setMessages([
          ...context,
          { id: assistantId, role: "assistant", content: completeAnswer },
        ]);
      }

      const regenerated = [
        ...context,
        { id: assistantId, role: "assistant" as const, content: completeAnswer },
      ];
      setMessages(regenerated);

      if (!isTemporary && runId) {
        const patch =
          assistantIndex === 1
            ? { output: completeAnswer, model: nextModel }
            : {
                model: nextModel,
                followUps: regenerated.slice(2).map((message) => ({
                  role: message.role,
                  content: message.content,
                  createdAt: new Date().toISOString(),
                })),
              };
        await fetch(`/api/runs/${runId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      }
    } catch (failure) {
      setMessages(previousMessages);
      setError(
        failure instanceof Error
          ? failure.message
          : "Kai Studio could not regenerate that reply.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  const selectedModel =
    modelOptions.find((option) => option.value === model) ?? modelOptions[1];

  return (
    <section className={`kai-chat-canvas kai-chat-${messages.length === 0 ? "empty" : "active"} ${isDocumentVisible ? "" : "kai-chat-hidden"} relative flex h-screen min-w-0 flex-1 flex-col overflow-hidden`}>
      <div className="kai-chat-atmosphere" aria-hidden="true" />
      <header className="kai-chat-topbar relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-4 sm:px-7">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("kai:toggle-chat-sidebar"))}
            className="rounded-lg border border-white/10 px-2.5 py-2 text-sm text-slate-400 transition hover:border-sky-400/30 hover:bg-sky-400/10 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300/70"
            aria-label="Toggle Chat sidebar"
            title="Toggle Chat sidebar (⌘\\)"
          >
            ☰
          </button>
          <Link
            href="/"
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-400 transition hover:border-sky-400/30 hover:bg-sky-400/10 hover:text-sky-200"
            aria-label="Back to Dashboard"
          >
            ←
          </Link>
          <button
            type="button"
            onClick={startNewChat}
            disabled={isRunning || isRecording || isTranscribing}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            ＋ New chat
          </button>
          <button
            type="button"
            onClick={toggleTemporaryChat}
            disabled={isRunning || isRecording || isTranscribing}
            className={`rounded-lg border px-3 py-2 text-sm transition disabled:opacity-50 ${
              isTemporary
                ? "border-sky-400/30 bg-sky-400/15 text-sky-200"
                : "border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
            }`}
            title="Uses Kai Memory but does not save this conversation"
          >
            ◌ Temporary
          </button>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">Kai Studio Chat</p>
          <p className="text-[11px] text-emerald-400">
            {isTemporary ? "Temporary · not saved" : "Private · on this Mac"}
            {memoryStatus?.active ? " · Memory active" : ""}
          </p>
        </div>
        <div className="w-[88px]" />
      </header>

      <div
        ref={scrollContainerRef}
        onScroll={handleConversationScroll}
        className="relative z-10 min-h-0 flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <div className="kai-empty-state mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-6 pb-32 text-center">
            <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
              What&apos;s on your mind?
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-slate-500">
              {isTemporary
                ? "Kai Memory is available, but this conversation will disappear when you leave."
                : "Chat with your configured local models. Attach a photo whenever visual context helps."}
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-5 pb-40 pt-6 sm:px-8">
            <div className="space-y-8">
              {messages.map((message, index) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[85%]"
                      : "max-w-full"
                  }
                >
                  {message.images?.length ? (
                    <div className="mb-3 flex flex-wrap justify-end gap-2">
                      {message.images.map((image) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={image.id}
                          src={image.dataUrl}
                          alt={image.name}
                          className="h-28 w-28 rounded-xl border border-white/10 object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                  {message.generatedImage ? (
                    <div className="mb-4 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={message.generatedImage}
                        alt={message.content || "Image generated by Kai Studio"}
                        className="h-auto w-full"
                      />
                      <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
                        <span className="text-xs text-slate-500">{message.imageGeneration?.status === "unverified" ? "Created locally · review unavailable" : "Created locally · requirements checked"}</span>
                        <a
                          href={message.generatedImage}
                          download={`kai-studio-${message.id}.png`}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
                        >
                          Download
                        </a>
                      </div>
                      {message.imageGeneration ? (
                        <details className="border-t border-white/10 px-4 py-3 text-xs text-slate-500">
                          <summary className="cursor-pointer text-sky-200">Generation details</summary>
                          <div className="mt-3 space-y-2 leading-5">
                            <p>Visual brief: {message.imageGeneration.intent?.subject ?? "Structured locally"}</p>
                            <p>Attempts: {message.imageGeneration.attempts.length} · status: {message.imageGeneration.status}</p>
                            {message.imageGeneration.attempts.map((attempt) => <p key={attempt.number}>Attempt {attempt.number}: {attempt.status}{attempt.review ? ` · review score ${Math.round(attempt.review.score * 100)}%` : ""}</p>)}
                            {message.imageGeneration.stages.map((stage) => <p key={stage}>• {stage}</p>)}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                  {message.role === "user" ? (
                    <div className="rounded-3xl rounded-br-md bg-[#20242d] px-5 py-3.5 text-sm leading-7 text-slate-100">
                      {message.content}
                    </div>
                  ) : message.content ? (
                    <>
                      <div className="flex gap-4">
                        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-400/20 text-xs font-bold text-sky-200">
                          K
                        </div>
                        <MarkdownResponse className="min-w-0 flex-1 border-0 bg-transparent p-0">
                          {message.content}
                        </MarkdownResponse>
                      </div>
                      {isApplyingBuild && buildProgress.length ? <div className="ml-11 mt-4 space-y-2 rounded-2xl border border-sky-300/15 bg-sky-400/5 p-4 text-sm">{buildProgress.map((step, stepIndex) => <p key={`${stepIndex}-${step}`} className={stepIndex === buildProgress.length - 1 ? "animate-pulse text-sky-200" : "text-slate-500"}>{step}</p>)}</div> : null}
                      {activeLoopState ? <div className="ml-11 mt-3 grid gap-2 rounded-xl border border-sky-300/10 bg-sky-400/[0.035] p-3 text-xs text-slate-500 sm:grid-cols-2"><p>{activeLoopState.currentRole} · {activeLoopState.currentPhase}</p><p>{activeLoopState.elapsedMinutes.toFixed(1)} / {activeLoopState.executionBudgetMinutes || "—"} min</p><p>Implementation: {activeLoopState.stepCount} / {activeLoopState.stepLimit}</p><p>Inspection actions: {activeLoopState.inspectionCount}</p><p>Context: {Math.round(activeLoopState.contextUtilization * 100)}%</p><p>Reservations: {activeLoopState.activeReservations.length} · handoffs: {activeLoopState.pendingHandoffs}</p><p className="sm:col-span-2 text-slate-400">Latest progress: {activeLoopState.latestMeaningfulProgress}</p>{activeLoopState.currentBlockers.length ? <p className="sm:col-span-2 text-amber-200/70">Blocker: {activeLoopState.currentBlockers.at(-1)}</p> : null}{activeLoopState.resourceWarning ? <p className="sm:col-span-2 text-red-200/70">Resource warning: {activeLoopState.resourceWarning}</p> : null}<p className="sm:col-span-2">Automatic time: +{activeLoopState.automaticExtensionMinutes} min · approved time: +{activeLoopState.userExtensionMinutes} min</p></div> : null}
                      {codingRuntimeState ? <div className="ml-11 mt-3 rounded-xl border border-sky-300/10 bg-sky-400/[0.025] p-3 text-xs text-slate-500"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-sky-200">Shared coding runtime</p><p>{codingRuntimeState.plan.codingModel.displayName} · {codingRuntimeState.weightResidency} · {codingRuntimeState.memoryPressure} pressure</p></div><p className="mt-2">{codingRuntimeState.sessions.map((session) => `${session.role}: ${session.status} / ${session.kvCache} / ${Math.round(session.contextLimit / 1024)}K`).join(" · ")}</p><p className="mt-2">Coding retrieval: {codingRuntimeState.codingEmbeddingStatus} · KaiLore retrieval: {codingRuntimeState.kaiLoreEmbeddingStatus}</p>{codingRuntimeState.modelsReleasedBeforeCoding.length ? <p className="mt-2">Released before coding: {codingRuntimeState.modelsReleasedBeforeCoding.join(", ")}</p> : null}{codingRuntimeState.fallbackMode ? <p className="mt-2 text-amber-200/70">Fallback: {codingRuntimeState.fallbackMode}</p> : null}</div> : null}
                      {activeLoopState?.awaitingExtension ? <div className="ml-11 mt-4 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm"><p className="font-medium text-amber-100">The coding loop is paused at {activeLoopState.stepCount} implementation steps.</p><p className="mt-1 text-amber-200/70">Inspection activity: {activeLoopState.inspectionCount}. Extensions used: {activeLoopState.extensionCount}.</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => void decideActiveLoop("extend")} className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950">Extend by 50 steps</button><button type="button" onClick={() => void decideActiveLoop("stop")} className="rounded-lg border border-amber-200/30 px-3 py-2 text-xs text-amber-100">Stop and preserve work</button></div></div> : null}
                      {activeLoopState?.awaitingTimeDecision ? <div className="ml-11 mt-4 rounded-2xl border border-sky-300/30 bg-sky-300/10 p-4 text-sm"><p className="font-medium text-sky-100">The coding job reached its time budget and paused safely.</p><p className="mt-1 text-sky-200/70">Its checkout, memories, reservations, counters, and latest evidence remain preserved.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void decideActiveLoop("time_extend_15")} className="rounded-lg bg-sky-300 px-3 py-2 text-xs font-semibold text-slate-950">Continue 15 min</button><button type="button" onClick={() => void decideActiveLoop("time_extend_30")} className="rounded-lg bg-sky-300 px-3 py-2 text-xs font-semibold text-slate-950">Continue 30 min</button><button type="button" onClick={() => void decideActiveLoop("time_stop")} className="rounded-lg border border-sky-200/30 px-3 py-2 text-xs text-sky-100">Stop for review</button><button type="button" onClick={() => void decideActiveLoop("cancel")} className="rounded-lg border border-red-300/30 px-3 py-2 text-xs text-red-200">Cancel</button></div></div> : null}
                      {index === messages.length - 1 && !isRunning && (
                        <>{pendingBuildId ? <button ref={applyBuildButtonRef} type="button" onClick={applyPendingBuild} disabled={isApplyingBuild} className="mt-5 rounded-xl border border-sky-300/30 bg-sky-400/15 px-4 py-2.5 text-sm font-medium text-sky-100 hover:bg-sky-400/25 disabled:opacity-50">{isApplyingBuild ? "Building, testing & repairing…" : "Build locally & verify"}</button> : reviewedBuildId ? <button type="button" onClick={pushReviewedBuild} disabled={isApplyingBuild} className="mt-5 rounded-xl border border-sky-300/30 bg-sky-400/15 px-4 py-2.5 text-sm font-medium text-sky-100 hover:bg-sky-400/25 disabled:opacity-50">{isApplyingBuild ? "Opening draft PR…" : "Push branch & open draft PR"}</button> : <ResponseActions content={message.content} currentModel={model} onRegenerate={regenerateLastResponse} />}</>
                      )}
                    </>
                  ) : (
                    <div className="flex items-start gap-4 text-sm text-slate-500">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500 text-xs font-bold text-white">
                        K
                      </span>
                      {buildProgress.length ? <div className="space-y-2">{buildProgress.map((step, stepIndex) => <p key={`${stepIndex}-${step}`} className={stepIndex === buildProgress.length - 1 ? "animate-pulse text-sky-200" : "text-slate-600"}>{step}</p>)}</div> : <span className="animate-pulse">{composerMode === "image" ? "Creating…" : "Thinking…"}</span>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#0a0d14] via-[#0a0d14] to-transparent px-4 pb-5 pt-14 sm:px-8">
        <form
          ref={composerFormRef}
          onSubmit={sendMessage}
          className="kai-chat-composer pointer-events-auto mx-auto max-w-3xl rounded-[1.65rem] border border-white/10 bg-[#181c24]/90 p-2 shadow-2xl shadow-black/35 backdrop-blur-xl focus-within:border-sky-300/25"
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pb-2">
              {images.map((image) => (
                <div key={image.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.dataUrl}
                    alt={image.name}
                    className="h-20 w-20 rounded-xl object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setImages((current) =>
                        current.filter((item) => item.id !== image.id),
                      )
                    }
                    className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/90 text-sm hover:bg-red-500"
                    aria-label={`Remove ${image.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            rows={1}
            value={draft}
            disabled={isRunning || isRecording || isTranscribing}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={
              composerMode === "image"
                ? "Describe the image you want to create"
                : "Message Gemma"
            }
            className="max-h-40 min-h-12 w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-6 outline-none placeholder:text-slate-600 disabled:opacity-60"
          />

          {error && (
            <div className="mx-2 mb-2 rounded-lg bg-red-400/10 px-3 py-2 text-xs text-red-300">
              <p>{error}</p>
              {imageErrorTechnical?.suggestedAction && <p className="mt-1 text-red-200/80">{imageErrorTechnical.suggestedAction}</p>}
              {imageErrorTechnical && (
                <details className="mt-2 text-red-200/80">
                  <summary className="cursor-pointer">Technical details</summary>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                    <dt>Request</dt><dd>{imageErrorTechnical.requestId ?? "Unavailable"}</dd>
                    <dt>Stage</dt><dd>{imageErrorTechnical.stage ?? "Unavailable"}</dd>
                    <dt>Runtime</dt><dd>{imageErrorTechnical.provider ?? "Unavailable"}</dd>
                    <dt>Error class</dt><dd>{imageErrorTechnical.errorClass ?? "Unavailable"}</dd>
                    <dt>Retry</dt><dd>{imageErrorTechnical.retryAvailable ? "Available" : "Not available"}</dd>
                    {Object.entries(imageErrorTechnical.metadata ?? {}).filter(([, value]) => value !== undefined).map(([key, value]) => <Fragment key={key}><dt>{key}</dt><dd>{String(value)}</dd></Fragment>)}
                  </dl>
                </details>
              )}
            </div>
          )}

          {(isRecording || isTranscribing) && (
            <div className="mx-2 mb-2 flex items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs text-sky-200">
              <span className={isRecording ? "animate-pulse" : ""}>●</span>
              <span>
                {isRecording
                  ? `Listening… ${recordingSeconds}s / ${MAX_RECORDING_SECONDS}s`
                  : "Writing out your recording…"}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 px-1 pb-1">
            <div className="flex items-center gap-1">
              <div className="mr-1 flex rounded-full bg-black/20 p-1">
                <button
                  type="button"
                  onClick={() => setComposerMode("chat")}
                  disabled={isRunning || isRecording || isTranscribing}
                  className={`rounded-full px-3 py-1.5 text-xs transition ${
                    composerMode === "chat"
                      ? "border border-sky-400/25 bg-sky-400/15 text-sky-200 shadow-[inset_0_1px_0_rgba(125,211,252,0.12)] backdrop-blur-md"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setComposerMode("image");
                    setImages([]);
                  }}
                  disabled={Boolean(repositoryHandoff) || isRunning || isRecording || isTranscribing}
                  className={`rounded-full px-3 py-1.5 text-xs transition ${
                    composerMode === "image"
                      ? "border border-sky-400/25 bg-sky-400/15 text-sky-200 shadow-[inset_0_1px_0_rgba(125,211,252,0.12)] backdrop-blur-md"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Image
                </button>
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={addImages}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={
                  composerMode === "image" ||
                  images.length >= MAX_IMAGES ||
                  isRunning ||
                  isRecording ||
                  isTranscribing
                }
                className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                aria-label="Attach photos"
              >
                ＋
              </button>
              {composerMode === "chat" && (
                <button
                  type="button"
                  onClick={() =>
                    isRecording ? void finishRecording() : void startRecording()
                  }
                  disabled={isRunning || isTranscribing}
                  className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm transition disabled:opacity-40 ${
                    isRecording
                      ? "border border-sky-300/35 bg-sky-400/20 text-sky-100"
                      : "text-slate-400 hover:bg-sky-400/10 hover:text-sky-200"
                  }`}
                  aria-label={
                    isRecording ? "Stop recording" : "Dictate a message"
                  }
                  title={
                    isRecording
                      ? "Stop and transcribe"
                      : "Dictate a message (up to 30 seconds)"
                  }
                >
                  {isRecording ? "■" : "◉"}
                </button>
              )}

              {composerMode === "chat" ? (
              <label className="relative">
                <span className="sr-only">Gemma model</span>
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  disabled={Boolean(repositoryHandoff) || isRunning || isRecording || isTranscribing}
                  className="appearance-none rounded-full border border-sky-400/25 bg-sky-400/10 py-2 pl-3 pr-7 text-xs font-medium text-sky-200 outline-none transition hover:bg-sky-400/15 disabled:opacity-50"
                >
                  {(repositoryHandoff ? modelOptions.filter((option) => option.value === model) : modelOptions).map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      className="bg-[#181c24]"
                    >
                      {option.label} · {option.detail}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-sky-400">
                  ▾
                </span>
              </label>
              ) : (
                <span className="rounded-full px-3 py-2 text-xs font-medium text-sky-300">
                  Image generation
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={
                (!draft.trim() && images.length === 0) ||
                isRunning ||
                isRecording ||
                isTranscribing
              }
              className="flex h-9 w-9 items-center justify-center rounded-full border border-sky-300/35 bg-sky-400/20 text-sm font-semibold text-sky-100 shadow-[inset_0_1px_0_rgba(186,230,253,0.18)] transition hover:bg-sky-400/30 disabled:border-white/5 disabled:bg-white/5 disabled:text-slate-700"
              aria-label="Send message"
            >
              {isRunning ? "·" : "↑"}
            </button>
          </div>
        </form>
        <p className="pointer-events-auto mx-auto mt-2 max-w-3xl text-center text-[10px] text-slate-700">
          {isTemporary
            ? "Temporary chat · Kai Memory stays active · nothing is saved to History."
            : composerMode === "image"
            ? "Kai Studio plans, validates, generates, and reviews every image locally."
            : repositoryHandoff
              ? `Secure build for ${repositoryHandoff.fullName} · independent security review, configured coding model, and human approval.`
              : `${selectedModel.label} runs locally. Check important information.`}
        </p>
      </div>
    </section>
  );
}

function modelLabel(model: string) {
  return model.replace(/^hf:/, "").replace(/[-_:]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
