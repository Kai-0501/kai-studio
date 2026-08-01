export function parseModelJson<T>(content: string): T {
  const trimmed = content.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The local agent did not return a JSON object.");
  return JSON.parse(unfenced.slice(start, end + 1)) as T;
}
