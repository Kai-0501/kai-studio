export const runtime = "nodejs";

const imageModel = "x/z-image-turbo";
const ollamaGenerateUrl = "http://127.0.0.1:11434/api/generate";

export async function POST(request: Request) {
  const body = (await request.json()) as { prompt?: unknown };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt || prompt.length > 8_000) {
    return Response.json(
      { error: "Describe the image you want to create." },
      { status: 400 },
    );
  }

  let ollamaResponse: Response;

  try {
    ollamaResponse = await fetch(ollamaGenerateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: imageModel,
        prompt,
        width: 1024,
        height: 1024,
        stream: false,
      }),
      signal: request.signal,
    });
  } catch {
    return Response.json(
      {
        error:
          "Kai Studio could not reach Ollama. Make sure the Ollama app is running.",
      },
      { status: 503 },
    );
  }

  if (!ollamaResponse.ok) {
    const details = await ollamaResponse.text();
    const missingModel =
      ollamaResponse.status === 404 || details.includes("not found");
    return Response.json(
      {
        error: missingModel
          ? "Z-Image Turbo is not installed in Ollama."
          : details || "Z-Image Turbo could not create that image.",
      },
      { status: ollamaResponse.status || 502 },
    );
  }

  const result = (await ollamaResponse.json()) as {
    image?: unknown;
  };

  if (typeof result.image !== "string" || !result.image) {
    return Response.json(
      { error: "Z-Image Turbo finished without returning an image." },
      { status: 502 },
    );
  }

  return Response.json({
    image: `data:image/png;base64,${result.image}`,
    model: imageModel,
  });
}
