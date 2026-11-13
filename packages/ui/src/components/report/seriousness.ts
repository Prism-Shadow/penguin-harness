/**
 * Which errors offer a report — the one rule every entry point asks.
 *
 * A report is for a defect: something went wrong that the person did not cause and cannot fix.
 * The server already draws that line (an `HttpError` is an expected failure with a named code; an
 * unexpected one is converged to a 500 coded `internal`), and this follows it:
 *
 * - an answer from the server — anything shaped like the web app's `ApiError`, a numeric `status`
 *   and a string `code` — is serious only when the server converged it (`internal`) or answered a
 *   5xx it did not name at all (`http_error`, a body without a code). A named code is the server
 *   saying what is wrong and what to do: validation, sign-in, permission, not found, conflict,
 *   rate limits, a machine out of reach, a proxy in the way, the network gone. Those are the
 *   person's to fix, and a report would be noise;
 * - a stop the person made (an `AbortError`) is not an error at all;
 * - anything else thrown — a `TypeError`, an exception the app did not expect — is a defect, and
 *   so is a render crash.
 */

export function isSeriousError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  if (typeof err === "object") {
    const { name, status, code } = err as { name?: unknown; status?: unknown; code?: unknown };
    if (name === "AbortError") return false;
    if (typeof status === "number" && typeof code === "string") {
      return code === "internal" || (status >= 500 && code === "http_error");
    }
  }
  return true;
}
