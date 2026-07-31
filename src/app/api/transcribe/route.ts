import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const MAX_AUDIO_BYTES = 1_200_000;

function audioRuntimeDirectory() {
  return (
    process.env.KAI_STUDIO_AUDIO_DIR ??
    path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "kai-studio",
      "audio-runtime",
    )
  );
}

export async function POST(request: Request) {
  let body: { audio?: string };

  try {
    body = (await request.json()) as { audio?: string };
  } catch {
    return Response.json({ error: "That recording could not be read." }, { status: 400 });
  }

  if (!body.audio) {
    return Response.json({ error: "No recording was supplied." }, { status: 400 });
  }

  let audio: Buffer;
  try {
    audio = Buffer.from(body.audio, "base64");
  } catch {
    return Response.json({ error: "That recording could not be decoded." }, { status: 400 });
  }

  if (audio.length === 0 || audio.length > MAX_AUDIO_BYTES) {
    return Response.json(
      { error: "Recordings can be up to 30 seconds long." },
      { status: 413 },
    );
  }

  const runtimeDirectory = audioRuntimeDirectory();
  const transcriber =
    process.env.KAI_STUDIO_TRANSCRIBER_PATH ??
    path.join(process.cwd(), "vendor", "audio", "fluidaudiocli");
  const modelDirectory =
    process.env.KAI_STUDIO_AUDIO_MODEL_DIR ??
    path.join(runtimeDirectory, "parakeet-tdt-0.6b-v2");
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kai-audio-"));
  const audioPath = path.join(temporaryDirectory, "dictation.wav");
  const resultPath = path.join(temporaryDirectory, "transcript.json");

  try {
    await writeFile(audioPath, audio);
    await execFileAsync(
      transcriber,
      [
        "transcribe",
        audioPath,
        "--model-version",
        "v2",
        "--model-dir",
        modelDirectory,
        "--output-json",
        resultPath,
      ],
      {
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    const result = JSON.parse(await readFile(resultPath, "utf8")) as {
      text?: string;
      confidence?: number;
    };
    const transcript = result.text?.trim() ?? "";
    if (!transcript) {
      return Response.json(
        { error: "I couldn’t hear any speech in that recording." },
        { status: 422 },
      );
    }

    return Response.json({
      transcript,
      confidence: result.confidence,
    });
  } catch (failure) {
    console.error("Audio transcription failed", failure);
    return Response.json(
      {
        error: "That recording could not be transcribed. Please try again.",
      },
      { status: 503 },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
