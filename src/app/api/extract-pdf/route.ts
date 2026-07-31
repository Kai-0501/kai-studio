export const runtime = "nodejs";

const maximumFileSize = 20 * 1024 * 1024;
const maximumCharacters = 250_000;

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a PDF file." }, { status: 400 });
  }

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "Only PDF files are supported." }, { status: 400 });
  }

  if (file.size > maximumFileSize) {
    return Response.json(
      { error: "The PDF is larger than the 20 MB limit." },
      { status: 413 },
    );
  }

  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const pageCount = pdf.numPages;
    const pages: string[] = [];
    let characterCount = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (pageText) {
        const remaining = maximumCharacters - characterCount;
        pages.push(pageText.slice(0, remaining));
        characterCount += Math.min(pageText.length, remaining);
      }

      page.cleanup();
      if (characterCount >= maximumCharacters) break;
    }

    await loadingTask.destroy();
    const text = pages.join("\n\n");

    if (!text.trim()) {
      return Response.json(
        {
          error:
            "No selectable text was found. This may be a scanned image PDF; paste the text manually instead.",
        },
        { status: 422 },
      );
    }

    return Response.json({
      text,
      fileName: file.name,
      pageCount,
      truncated: characterCount >= maximumCharacters,
    });
  } catch (error) {
    console.error("PDF extraction failed:", error);
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const reason =
      message.includes("password") || message.includes("encrypted")
        ? "This PDF is password-protected or encrypted. Export an unlocked copy and try again."
        : message.includes("invalid pdf") || message.includes("format")
          ? "This PDF has an invalid or unsupported structure. Re-export it as a new PDF and try again."
          : "Kai Studio could not parse this PDF. Try downloading it fully from iCloud or re-exporting it as a new PDF.";

    return Response.json(
      { error: reason },
      { status: 422 },
    );
  }
}
