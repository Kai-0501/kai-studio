const ollamaChatUrl = "http://127.0.0.1:11434/api/chat";

function fallbackTitle(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  if (
    lower.includes("nutrition") &&
    (lower.includes("drink") || lower.includes("bottle"))
  ) {
    return "Drink Nutrition & Fat-Loss Review";
  }

  if (
    (lower.includes("dinner") || lower.includes("meal")) &&
    lower.includes("fat loss")
  ) {
    return "Dinner Ingredients & Fat-Loss Review";
  }

  const words = normalized
    .replace(
      /^(please\s+|can you\s+|could you\s+|would you\s+|help me\s+|i want you to\s+)/i,
      "",
    )
    .split(" ")
    .filter(Boolean)
    .slice(0, 7);

  const title = words
    .join(" ")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\b\w/g, (character) => character.toUpperCase());

  return title || "New Conversation";
}

function cleanGeneratedTitle(value: string) {
  const title = value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^#+\s*/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(title|conversation title)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title || title.length > 72 || title.split(" ").length > 10) return "";
  return title;
}

export async function generateChatTitle(
  message: string,
  answer: string,
  model: string,
) {
  const fallback = fallbackTitle(message);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);

  try {
    const response = await fetch(ollamaChatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        messages: [
          {
            role: "user",
            content: `Create a concise title for this conversation.

Rules:
- Use 3 to 7 words.
- Describe the main topic, not the task wording.
- Use title case.
- Do not use quotation marks, punctuation at the end, or labels.
- Return only the title.

User message:
${message.slice(0, 1_200)}

Assistant answer excerpt:
${answer.slice(0, 1_200)}`,
          },
        ],
        options: {
          temperature: 0.1,
          num_predict: 24,
        },
        keep_alive: "5m",
      }),
      signal: controller.signal,
    });

    if (!response.ok) return fallback;

    const result = (await response.json()) as {
      message?: { content?: string };
    };

    return cleanGeneratedTitle(result.message?.content ?? "") || fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}
