import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateForRole, generateImageForRole, resolveRole } from "@/lib/models/runtime";
import { ModelRuntimeError } from "@/lib/models/types";
import { parseModelJson } from "@/lib/model-json";
import { readSettings } from "@/lib/settings-store";

const dataDirectory = process.env.KAI_STUDIO_DATA_DIR ?? path.join(process.cwd(), ".promptdeck");
const imageDirectory = path.join(dataDirectory, "generated-images");
const historyFile = path.join(dataDirectory, "image-generations.json");
const historyTempFile = path.join(dataDirectory, "image-generations.tmp.json");

export type RequirementImportance = "mandatory" | "preferred" | "decorative";
export type VisualRequirement = { id: string; category: string; description: string; importance: RequirementImportance; mustShow?: boolean; mustNotShow?: boolean; evaluationMethod: string; confidence: number; status?: "pending" | "satisfied" | "failed" | "uncertain"; evidence?: string };
export type VisualIntent = {
  originalPrompt: string;
  purpose: string;
  subject: string;
  environment?: string;
  style?: string;
  mood?: string;
  architectureSpatial?: string;
  objects?: string[];
  materials?: string[];
  lighting?: string;
  camera?: string;
  composition?: string;
  palette?: string;
  text?: string;
  requirements: VisualRequirement[];
  forbiddenElements: string[];
  ambiguities: string[];
  aspectRatio: "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
};
export type ImageAttempt = { number: number; provider: string; model: string; compiledPrompt: string; artifactPath: string; status: "generated" | "reviewed" | "unverified" | "failed"; review?: ReviewResult; correction?: string; createdAt: string };
export type ReviewResult = { score: number; requirements: Array<{ id: string; status: "satisfied" | "failed" | "uncertain"; confidence: number; evidence: string }>; forbiddenMatches: string[]; overallNotes: string };
export type ImageGenerationRecord = { id: string; status: "complete" | "unverified" | "failed"; createdAt: string; updatedAt: string; intent: VisualIntent; attempts: ImageAttempt[]; selectedAttempt?: number; error?: string };
export type ImageGenerationStage = "request-accepted" | "visual-intent" | "intent-validation" | "prompt-compilation" | "provider-request" | "provider-response" | "artifact-validation" | "vision-review" | "retry-decision";
export type ImageGenerationDiagnostic = { requestId: string; stage: ImageGenerationStage; success: boolean; payloadType: string; payloadLength?: number; expectedSchema: string; elapsedMs: number; errorClass?: string; message?: string; metadata?: Record<string, string | number | boolean | undefined> };

export class ImageGenerationError extends Error {
  readonly requestId: string;
  readonly stage: ImageGenerationStage;
  readonly provider?: string;
  readonly errorClass: string;
  readonly retryAvailable: boolean;
  readonly suggestedAction?: string;
  readonly metadata?: Record<string, string | number | boolean | undefined>;

  constructor(message: string, details: Omit<ImageGenerationError, "message" | "name" | "stack">) {
    super(message);
    this.name = "ImageGenerationError";
    this.requestId = details.requestId;
    this.stage = details.stage;
    this.provider = details.provider;
    this.errorClass = details.errorClass;
    this.retryAvailable = details.retryAvailable;
    this.suggestedAction = details.suggestedAction;
    this.metadata = details.metadata;
  }
}

type ProviderProfile = { provider: string; supportsNegativePrompt: boolean; maxPromptLength: number; supportedAspectRatios: VisualIntent["aspectRatio"][]; width: number; height: number };
const genericOllamaImageProfile: ProviderProfile = { provider: "ollama", supportsNegativePrompt: false, maxPromptLength: 7_500, supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"], width: 1024, height: 1024 };

function clampText(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function id() { return crypto.randomUUID(); }
function isAspect(value: unknown): value is VisualIntent["aspectRatio"] { return ["1:1", "4:3", "3:4", "16:9", "9:16"].includes(String(value)); }

export function normalizeVisualIntent(value: unknown, originalPrompt: string): VisualIntent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const requirements = Array.isArray(raw.requirements) ? raw.requirements.slice(0, 24).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const requirement = item as Record<string, unknown>;
    const description = clampText(requirement.description, 500);
    if (!description) return [];
    const importance: RequirementImportance = ["mandatory", "preferred", "decorative"].includes(String(requirement.importance)) ? requirement.importance as RequirementImportance : "preferred";
    return [{ id: clampText(requirement.id, 80).replace(/[^a-zA-Z0-9_-]/g, "-") || `requirement-${index + 1}`, category: clampText(requirement.category, 100) || "visual", description, importance, mustShow: requirement.mustShow !== false, mustNotShow: requirement.mustNotShow === true, evaluationMethod: clampText(requirement.evaluationMethod, 300) || "visual inspection", confidence: typeof requirement.confidence === "number" ? Math.max(0, Math.min(1, requirement.confidence)) : 0.7 }];
  }) : [];
  const mandatory = requirements.filter((requirement) => requirement.importance === "mandatory");
  if (!clampText(raw.subject, 300) || !mandatory.length) return null;
  return {
    originalPrompt,
    purpose: clampText(raw.purpose, 300) || "Create the requested image.",
    subject: clampText(raw.subject, 300),
    environment: clampText(raw.environment, 300), style: clampText(raw.style, 300), mood: clampText(raw.mood, 300), architectureSpatial: clampText(raw.architectureSpatial, 500),
    objects: Array.isArray(raw.objects) ? raw.objects.map((entry) => clampText(entry, 160)).filter(Boolean).slice(0, 20) : [],
    materials: Array.isArray(raw.materials) ? raw.materials.map((entry) => clampText(entry, 160)).filter(Boolean).slice(0, 20) : [],
    lighting: clampText(raw.lighting, 250), camera: clampText(raw.camera, 250), composition: clampText(raw.composition, 300), palette: clampText(raw.palette, 200), text: clampText(raw.text, 250),
    requirements,
    forbiddenElements: Array.isArray(raw.forbiddenElements) ? raw.forbiddenElements.map((entry) => clampText(entry, 200)).filter(Boolean).slice(0, 20) : [],
    ambiguities: Array.isArray(raw.ambiguities) ? raw.ambiguities.map((entry) => clampText(entry, 250)).filter(Boolean).slice(0, 10) : [],
    aspectRatio: isAspect(raw.aspectRatio) ? raw.aspectRatio : "1:1",
  };
}

function dimensions(aspectRatio: VisualIntent["aspectRatio"], profile: ProviderProfile) {
  const short = 768;
  if (aspectRatio === "16:9") return { width: 1024, height: 576 };
  if (aspectRatio === "9:16") return { width: 576, height: 1024 };
  if (aspectRatio === "4:3") return { width: 1024, height: 768 };
  if (aspectRatio === "3:4") return { width: 768, height: 1024 };
  return { width: profile.width || short, height: profile.height || short };
}

function compile(intent: VisualIntent, profile: ProviderProfile, correction?: string) {
  const pieces = [
    intent.subject, intent.environment && `Environment: ${intent.environment}.`, intent.architectureSpatial && `Spatial design: ${intent.architectureSpatial}.`, intent.style && `Style: ${intent.style}.`, intent.mood && `Mood: ${intent.mood}.`,
    intent.objects?.length && `Objects: ${intent.objects.join(", ")}.`, intent.materials?.length && `Materials: ${intent.materials.join(", ")}.`, intent.lighting && `Lighting: ${intent.lighting}.`, intent.camera && `Camera: ${intent.camera}.`, intent.composition && `Composition: ${intent.composition}.`, intent.palette && `Palette: ${intent.palette}.`, intent.text && `Visible text: ${intent.text}.`,
    `Must satisfy: ${intent.requirements.filter((requirement) => requirement.importance === "mandatory").map((requirement) => requirement.description).join("; ")}.`,
    intent.forbiddenElements.length ? `Do not include: ${intent.forbiddenElements.join("; ")}.` : "",
    correction ? `Correction for this attempt: ${correction}` : "",
  ].filter(Boolean).join(" ");
  return pieces.slice(0, profile.maxPromptLength);
}

function deterministicValidate(intent: VisualIntent, profile: ProviderProfile) {
  const missing = intent.requirements.filter((requirement) => requirement.importance === "mandatory" && !requirement.description).map((requirement) => requirement.id);
  if (missing.length) throw new Error(`The visual brief is missing mandatory requirements: ${missing.join(", ")}.`);
  if (!profile.supportedAspectRatios.includes(intent.aspectRatio)) throw new Error(`The configured image provider does not support ${intent.aspectRatio}.`);
  const contradictory = intent.requirements.filter((requirement) => requirement.mustShow && intent.forbiddenElements.some((forbidden) => forbidden.toLowerCase() === requirement.description.toLowerCase()));
  if (contradictory.length) throw new Error("The visual brief contains a must-show / must-not-show conflict that needs clarification.");
}

async function readHistory(): Promise<ImageGenerationRecord[]> { try { return JSON.parse(await readFile(historyFile, "utf8")) as ImageGenerationRecord[]; } catch { return []; } }
async function persist(record: ImageGenerationRecord) { const all = await readHistory(); const next = [record, ...all.filter((item) => item.id !== record.id)].slice(0, 100); await mkdir(dataDirectory, { recursive: true }); await writeFile(historyTempFile, JSON.stringify(next, null, 2)); await rename(historyTempFile, historyFile); }
async function writeArtifact(recordId: string, attempt: number, base64: string) { await mkdir(imageDirectory, { recursive: true }); const file = path.join(imageDirectory, `${recordId}-${attempt}.png`); await writeFile(file, Buffer.from(base64, "base64")); return file; }
export async function imageDataUrl(record: ImageGenerationRecord, attempt = record.selectedAttempt) { const selected = record.attempts.find((item) => item.number === attempt); if (!selected) return null; try { return `data:image/png;base64,${(await readFile(selected.artifactPath)).toString("base64")}`; } catch { return null; } }

async function plan(prompt: string) {
  const result = await generateForRole({ role: "image.planner", workflow: "kai-studio.image.planner", temperature: 0, maxTokens: 4000, reasoning: "disabled", messages: [{ role: "system", content: "You are a bounded visual-intent planner. Return ONLY valid JSON. Never explain your reasoning. Translate the request into {purpose,subject,environment,style,mood,architectureSpatial,objects,materials,lighting,camera,composition,palette,text,requirements,forbiddenElements,ambiguities,aspectRatio}. Requirements must be atomic and include id, category, description, importance (mandatory/preferred/decorative), mustShow, mustNotShow, evaluationMethod, confidence. Mark the main subject and any explicit architectural/spatial constraint as mandatory. Do not invent user preferences. If a material ambiguity makes generation materially different, put it in ambiguities." }, { role: "user", content: prompt }] });
  return normalizeVisualIntent(parseModelJson(result.text), prompt);
}

async function review(intent: VisualIntent, base64: string, timeoutMs: number): Promise<ReviewResult> {
  const result = await generateForRole({ role: "vision.reviewer", workflow: "kai-studio.image.review", temperature: 0, maxTokens: 3500, signal: AbortSignal.timeout(timeoutMs), reasoning: "disabled", messages: [{ role: "system", content: "You are a strict image-reviewer. Return ONLY JSON {score:number,requirements:[{id,status,confidence,evidence}],forbiddenMatches:string[],overallNotes:string}. Review only visible evidence. status must be satisfied, failed, or uncertain. Do not invent details." }, { role: "user", content: [{ type: "text", text: JSON.stringify({ requirements: intent.requirements, forbiddenElements: intent.forbiddenElements }) }, { type: "image", data: base64, mimeType: "image/png" }] }] });
  const raw = parseModelJson<Record<string, unknown>>(result.text);
  if (!raw || !Array.isArray(raw.requirements)) throw new Error("The vision reviewer returned an invalid review.");
  return { score: typeof raw.score === "number" ? Math.max(0, Math.min(1, raw.score)) : 0, requirements: raw.requirements.flatMap((item) => { if (!item || typeof item !== "object") return []; const row = item as Record<string, unknown>; const status = ["satisfied", "failed", "uncertain"].includes(String(row.status)) ? row.status as "satisfied" | "failed" | "uncertain" : "uncertain"; return typeof row.id === "string" ? [{ id: row.id, status, confidence: typeof row.confidence === "number" ? Math.max(0, Math.min(1, row.confidence)) : 0, evidence: clampText(row.evidence, 600) }] : []; }), forbiddenMatches: Array.isArray(raw.forbiddenMatches) ? raw.forbiddenMatches.map((entry) => clampText(entry, 200)).filter(Boolean) : [], overallNotes: clampText(raw.overallNotes, 1500) };
}

function reviewPasses(intent: VisualIntent, result: ReviewResult, threshold: number, retryPreferred: boolean) {
  if (result.forbiddenMatches.length) return false;
  const rows = new Map(result.requirements.map((row) => [row.id, row]));
  return intent.requirements.filter((requirement) => requirement.importance === "mandatory" || (retryPreferred && requirement.importance === "preferred")).every((requirement) => { const row = rows.get(requirement.id); return row?.status === "satisfied" && row.confidence >= threshold; });
}

function correction(intent: VisualIntent, result: ReviewResult) {
  const failed = result.requirements.filter((row) => row.status !== "satisfied").map((row) => `${row.id}: ${row.evidence}`);
  return `Preserve the requirements already met. Correct only these verified gaps: ${[...failed, ...result.forbiddenMatches.map((item) => `remove ${item}`)].join("; ") || "improve required visual fidelity"}.`;
}

function imageRuntimeMessage(category: ModelRuntimeError["category"] | undefined) {
  switch (category) {
    case "timeout":
      return { message: "Image generation took too long to complete.", suggestedAction: "Try again once. If it repeats, restart Ollama and check available memory." };
    case "unavailable":
      return { message: "The selected local image model is not available.", suggestedAction: "Open Settings and confirm that the image model is installed and enabled." };
    case "capability":
      return { message: "The selected model does not support local image generation.", suggestedAction: "Choose an installed image-generation model in Settings." };
    case "configuration":
      return { message: "Kai Studio's image model configuration needs attention.", suggestedAction: "Open Settings, choose an installed image model, and save the assignment." };
    case "cancelled":
      return { message: "Image generation was cancelled.", suggestedAction: "You can try the request again when ready." };
    default:
      return { message: "The local image runtime could not complete the request.", suggestedAction: "Try again once. If it repeats, restart Ollama and review the image-runtime details." };
  }
}

export async function runBoundedImagePipeline(prompt: string, onStage?: (stage: string) => void) {
  const requestId = id();
  const startedAt = performance.now();
  let currentStage: ImageGenerationStage = "request-accepted";
  const diagnostics: ImageGenerationDiagnostic[] = [];
  const mark = (stage: ImageGenerationStage, display: string, payloadType: string, payloadLength?: number) => {
    currentStage = stage;
    diagnostics.push({ requestId, stage, success: true, payloadType, payloadLength, expectedSchema: "kai-studio.image.v1", elapsedMs: Math.round(performance.now() - startedAt) });
    onStage?.(display);
  };
  try {
    if (!prompt.trim() || prompt.length > 8000) throw new Error("Describe the image in 1 to 8,000 characters.");
    mark("request-accepted", "Understanding your request…", "text", prompt.length);
    mark("visual-intent", "Understanding your request…", "structured-intent-request", prompt.length);
    const intent = await plan(prompt.trim());
    if (!intent) throw new Error("Kai Studio could not create a reliable visual brief. Please clarify the main subject and required details.");
    mark("intent-validation", "Preparing image instructions…", "visual-intent", intent.requirements.length);
    const selected = await resolveRole("image.generator");
    const profile: ProviderProfile = selected.model.provider === "ollama" ? genericOllamaImageProfile : { ...genericOllamaImageProfile, provider: selected.model.provider };
    deterministicValidate(intent, profile);
    const settings = await readSettings();
    const record: ImageGenerationRecord = { id: requestId, status: "failed", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), intent, attempts: [] };
    const maxAttempts = 1 + settings.imageGeneration.maxCorrectiveRetries;
    let best: ImageAttempt | undefined;
    let previousReview: ReviewResult | undefined;
    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      mark("prompt-compilation", attemptNumber === 1 ? "Preparing image instructions…" : `Correcting required details (${attemptNumber}/${maxAttempts})…`, "compiled-prompt");
      const compiledPrompt = compile(intent, profile, previousReview ? correction(intent, previousReview) : undefined);
      mark("provider-request", "Generating image…", "image-provider-request", Buffer.byteLength(compiledPrompt));
      const dimensionsForAttempt = dimensions(intent.aspectRatio, profile);
      const generated = await generateImageForRole("image.generator", { prompt: compiledPrompt, ...dimensionsForAttempt });
      mark("provider-response", "Saving image…", "base64-image", generated.imageBase64.length);
      const artifactPath = await writeArtifact(record.id, attemptNumber, generated.imageBase64);
      mark("artifact-validation", "Checking requirements…", "image-artifact");
      const item: ImageAttempt = { number: attemptNumber, provider: generated.provider, model: generated.modelId, compiledPrompt: settings.imageGeneration.preserveCompiledPrompts ? compiledPrompt : "[not retained]", artifactPath, status: "generated", createdAt: new Date().toISOString() };
      record.attempts.push(item);
      if (!settings.imageGeneration.autoReview) { item.status = "unverified"; best = item; break; }
      mark("vision-review", "Checking requirements…", "vision-review-request");
      try {
        const reviewed = await review(intent, generated.imageBase64, settings.imageGeneration.reviewTimeoutSeconds * 1000);
        item.review = reviewed; item.status = "reviewed";
        if (!best || reviewed.score > (best.review?.score ?? -1)) best = item;
        mark("retry-decision", "Checking requirements…", "review-result", reviewed.requirements.length);
        if (reviewPasses(intent, reviewed, settings.imageGeneration.mandatoryConfidenceThreshold, settings.imageGeneration.retryPreferredRequirements)) break;
        previousReview = reviewed;
      } catch (error) {
        if (settings.imageGeneration.visionUnavailableBehaviour === "fail") throw error;
        item.status = "unverified"; best = item; break;
      }
      record.updatedAt = new Date().toISOString(); await persist(record);
    }
    if (!best) throw new Error("The bounded image pipeline could not produce a candidate.");
    if (!settings.imageGeneration.saveAllAttempts) record.attempts = [best];
    record.selectedAttempt = best.number;
    record.status = best.status === "unverified" ? "unverified" : "complete";
    record.updatedAt = new Date().toISOString();
    await persist(record);
    onStage?.(record.status === "unverified" ? "Image created; visual review was unavailable." : "Complete.");
    return { record, image: await imageDataUrl(record), provider: profile.provider, diagnostics };
  } catch (error) {
    const failureStage = currentStage as ImageGenerationStage;
    const runtimeError = error instanceof ModelRuntimeError ? error : undefined;
    diagnostics.push({ requestId, stage: failureStage, success: false, payloadType: "none", expectedSchema: "kai-studio.image.v1", elapsedMs: Math.round(performance.now() - startedAt), errorClass: runtimeError?.category ?? (error instanceof Error ? error.name : "UnknownError"), message: error instanceof Error ? error.message.slice(0, 240) : "Unknown error", metadata: runtimeError?.details });
    const sourceMessage = error instanceof Error ? error.message : "Kai Studio could not create that image.";
    const runtimeFailure = imageRuntimeMessage(runtimeError?.category);
    const userMessage = failureStage === "provider-request" || failureStage === "provider-response"
      ? runtimeFailure.message
      : failureStage === "vision-review"
        ? "Vision review could not complete, but any generated image was preserved."
        : failureStage === "visual-intent"
          ? "Image request could not be parsed before generation."
          : sourceMessage;
    throw new ImageGenerationError(userMessage, {
      requestId,
      stage: failureStage,
      provider: runtimeError?.provider ?? (failureStage === "provider-request" || failureStage === "provider-response" ? "ollama" : undefined),
      errorClass: runtimeError?.category ?? (error instanceof Error ? error.name : "UnknownError"),
      retryAvailable: runtimeError?.category !== "configuration" && runtimeError?.category !== "capability",
      suggestedAction: failureStage === "provider-request" || failureStage === "provider-response" ? runtimeFailure.suggestedAction : undefined,
      metadata: runtimeError?.details,
    });
  }
}

export async function getImageGeneration(id: string) { return (await readHistory()).find((record) => record.id === id) ?? null; }
