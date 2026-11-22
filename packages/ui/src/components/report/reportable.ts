/**
 * Which errors offer a report — the one rule every entry point asks.
 *
 * Every failure offers one; a refusal does not. A refusal is the system working: it understood
 * what was asked, declined it, and its words say what to change. The server names its refusals
 * with a 4xx and a code (invalid input, a wrong password or an expired sign-in, no permission, a
 * thing that is not there, a name taken or a state conflict, a size or rate limit), and a check
 * the page makes before any request never reaches this rule at all.
 *
 * Everything else is a failure:
 *
 * - any 5xx, named or not (the server's converged `internal`, a machine out of reach, an upstream
 *   service that failed, a timeout);
 * - a 4xx whose code names a failure rather than a refusal: the server's convention is a code that
 *   ends in `_failed` or `_error` (`plugin_install_failed`, `import_failed`, `cdp_error`), the
 *   client's own `http_error` and `network_error` follow it;
 * - an answer that is not the server's (`not_the_server`: a proxy's or a dev server's page in its
 *   place), whatever status it came with;
 * - no answer at all (status 0: the network gone, a machine that did not answer, a stream's error
 *   event, which carries no status);
 * - anything thrown that is not an answer (a `TypeError`, an exception nobody expected), and a
 *   render crash.
 *
 * A stop the person made (an `AbortError`) is not an error at all, and nothing is nothing.
 */

/** A 4xx code that names a failure rather than a refusal: the server's convention. */
const FAILURE_CODE = /_(failed|error)$/;

export function isReportable(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  if (typeof err === "object") {
    const { name, status, code } = err as { name?: unknown; status?: unknown; code?: unknown };
    if (name === "AbortError") return false;
    if (typeof status === "number" && typeof code === "string") {
      // A refusal: a 4xx the server named. `not_the_server` is the client's own code for an
      // answer something else gave in the server's place, whatever status it came with.
      const refusal =
        status >= 400 && status < 500 && code !== "not_the_server" && !FAILURE_CODE.test(code);
      return !refusal;
    }
  }
  return true;
}
