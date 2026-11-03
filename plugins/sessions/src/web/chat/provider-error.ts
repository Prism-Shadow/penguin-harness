/**
 * Facts a provider's error message states in its own words, read back out of it: the records
 * carry the message (`request_end.error_message`) and not these facts on their own, so the
 * conversation's failure line and its report find them here rather than in fields of their own.
 *
 * - The HTTP status: the SDKs lead their errors with it ("503 {…}", "HTTP 429 …"), and gateways
 *   name it ("status code 502", `"status": 503`).
 * - The request id, where the provider names one for its support to look up (`"request_id":
 *   "req_…"`, "request ID req_…", `x-request-id: …`).
 *
 * Null when the message does not say: nothing is guessed.
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
