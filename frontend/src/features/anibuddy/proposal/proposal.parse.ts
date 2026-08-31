// Pull the JSON object out of a provider response.
//
// Strict structured output is requested on every call, so in the happy path the
// message content is already a bare JSON object. The tolerance below is for the
// paths where it is not: Open Quota may route to an upstream that ignores
// `response_format`, and some models fence their output in a markdown block even
// when told not to. Recovering a fenced object is not repairing a malformed
// proposal — the object either parses and passes revalidation or it does not.
//
// Extracted from the two existing AniBuddy routes, which had grown a copy each
// (`rig-analysis/route.ts` and `animate/route.ts`). One implementation so a fix
// to the fence stripping lands everywhere rather than in whichever copy the next
// author happens to open.

/** Concatenate the text parts of a provider message, whatever shape it took. */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: { text?: unknown }) =>
        typeof part?.text === "string" ? part.text : "",
      )
      .join("");
  }
  return "";
}

/** The first `choices[0].message.content` of an OpenAI-shaped response, as text. */
export function firstChoiceText(data: unknown): string {
  const choices = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices;
  return extractText(choices?.[0]?.message?.content);
}

/**
 * Parse a response body into a plain object, or null.
 *
 * Null means "there was no JSON object in there at all", which revalidation
 * reports as its own rejection reason. That distinction matters on the retry: a
 * model told "your JSON did not parse" behaves differently from one told "your
 * pivot hint was out of range".
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  if (!text) return null;

  const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  try {
    return asObject(JSON.parse(text));
  } catch {
    // Some models prefix a sentence before the object. Slicing between the outer
    // braces recovers it; anything that still fails to parse is a rejection.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return asObject(JSON.parse(text.slice(start, end + 1)));
    } catch {
      return null;
    }
  }
}
