/**
 * Facts a provider's error message states in its own words, read back out of it: the records
 * carry the message (`request_end.error_message`) and not these facts on their own, so the
 * conversation's failure line and its report find them here rather than in fields of their own.
 *
 * - The HTTP status: the SDKs lead their errors with it ("503 {…}", "HTTP 429 …"), and gateways
 *   name it ("status code 502", `"status": 503`).
 * - The request id, where the provider names one for its support to look up (`"request_id":
 *   "req_…"`, "request ID req_…", `x-request-id: …`).
 * - The sentence meant for a person, when the message is a JSON body (`400 {"type":"error",
 *   "error":{…,"message":"…"}}`): what a notice shows in place of the raw body.
 *
 * Null when the message does not say (the sentence: the message as it came): nothing is guessed.
 */

const LEADING_STATUS = /^\s*(?:HTTP\s*)?([1-5]\d\d)(?!\d)\b/i;
const NAMED_STATUS =
  /\b(?:status(?:[ _]?code)?|HTTP\/\d(?:\.\d)?)["']?\s*[:=]?\s*["']?([1-5]\d\d)(?!\d)/i;
const REQUEST_ID =
  /\b(?:x-)?request[_ -]?id["']?\s*[:=]?\s*["']?([A-Za-z0-9][A-Za-z0-9_.:-]{5,127})/i;

/** The HTTP status the message leads with or names; null when it names none. */
export function httpStatusOf(message: string | undefined): number | null {
  if (message === undefined) return null;
  const found = LEADING_STATUS.exec(message) ?? NAMED_STATUS.exec(message);
  return found === null ? null : Number(found[1]);
}

/** The request id the message names; null when it names none. */
export function requestIdOf(message: string | undefined): string | null {
  if (message === undefined) return null;
  // A trailing sentence stop is the sentence's, not the id's.
  return REQUEST_ID.exec(message)?.[1]?.replace(/[.:]+$/, "") ?? null;
}

/**
 * The sentence a provider's error says to a person. When the message is a JSON body, alone or
 * after the HTTP status an SDK leads with, that is the body's `error.message`, else its
 * `message`, else `error` or `detail` when either is a sentence. Any other message — plain text,
 * prose with a body inside it, a body holding no such sentence, one that does not parse — comes
 * back as it came.
 */
export function providerWordsOf(message: string): string {
  const start = message.indexOf("{");
  if (start === -1) return message;
  // Only the status may come before the body: anything else makes the whole message prose.
  if (!/^[\s:-]*$/.test(message.slice(0, start).replace(LEADING_STATUS, ""))) return message;
  let body: unknown;
  try {
    body = JSON.parse(message.slice(start));
  } catch {
    return message;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return message;
  const { error, message: said, detail } = body as Record<string, unknown>;
  const inner =
    error !== null && typeof error === "object" ? (error as { message?: unknown }).message : null;
  for (const words of [inner, said, error, detail]) {
    if (typeof words === "string" && words.trim() !== "") return words;
  }
  return message;
}
