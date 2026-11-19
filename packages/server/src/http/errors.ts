/**
 * Unified HTTP error: `{error: {code, message, details?}}` response body,
 * with message in English.
 *
 * Routes and services express business errors via throw HttpError; app-level onError
 * uniformly converges these into a JSON response, with unknown errors converged to 500
 * (never leaking internal details to the client).
 *
 * `details` carries the facts a client acts on beside the code — the id a 409 is about, say — so
 * that no client has to parse them out of the message, which is prose and may change.
 *
 * An HttpError is recognised by its brand, not by `instanceof`: a code plugin bundles its own copy
 * of this class (it reaches it through `@prismshadow/penguin-server/plugin`), and `instanceof`
 * against the host's class would miss every refusal its routes throw and answer them 500. The
 * brand is a key in the global symbol registry, so every copy of this module stamps and reads the
 * same one.
 */
import type { Context } from "hono";
import type { ErrorBody, ErrorDetails } from "../api/types.js";

const HTTP_ERROR_BRAND = Symbol.for("penguin.http-error");

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
Object.defineProperty(HttpError.prototype, HTTP_ERROR_BRAND, { value: true });

/**
 * Whether `err` is an HttpError from any copy of this module: it carries the brand and the fields
 * a response is built from. A look-alike without the brand (an error that merely calls itself
 * HttpError) is not one, and stays an unknown error.
 */
export function isHttpError(err: unknown): err is HttpError {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Partial<HttpError> & { [HTTP_ERROR_BRAND]?: unknown };
  return (
    e[HTTP_ERROR_BRAND] === true &&
    typeof e.status === "number" &&
    typeof e.code === "string" &&
    typeof e.message === "string"
  );
}

/** A 400 for a request the route cannot take as it is; validate.ts re-exports it beside its checks. */
export function badRequest(message: string): HttpError {
  return new HttpError(400, "bad_request", message);
}

export function errorBody(code: string, message: string, details?: ErrorDetails): ErrorBody {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

/**
 * Model missing a credential: the provider SDK throws this at **client-construction
 * time** (hit by both creating a Session and resuming a Session); the original message
 * is full of environment variable names, meaningless to a user — uniformly replaced
 * with a single actionable sentence. The frontend produces localized text by code
 * (message is only a fallback); see web's lib/api-error.ts.
 */
export function isMissingCredential(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /missing credentials|api[_ ]?key/i.test(message);
}

export function modelCredentialMissing(modelId: string): HttpError {
  return new HttpError(
    400,
    "model_credential_missing",
    `Model ${modelId} has no API key yet. Configure it on the Models page first.`,
  );
}

/** app.onError handler: maps HttpError (any copy, see isHttpError) through as-is; everything else is logged and converged to 500. */
export function handleError(err: Error, c: Context): Response {
  if (isHttpError(err)) {
    if (err.retryAfterSeconds !== undefined) {
      c.header("Retry-After", String(err.retryAfterSeconds));
    }
    return c.json(errorBody(err.code, err.message, err.details), err.status as 400);
  }
  // Unknown error: print the stack for diagnosis, but never expose details externally.
  console.error(`[server] Unhandled exception: ${err.stack ?? err.message}`);
  return c.json(errorBody("internal", "Internal server error."), 500);
}
