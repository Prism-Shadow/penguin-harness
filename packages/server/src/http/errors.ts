/**
 * Unified HTTP error: `{error: {code, message}}` response body,
 * with message in Chinese.
 *
 * Routes and services express business errors via throw HttpError; app-level onError
 * uniformly converges these into a JSON response, with unknown errors converged to 500
 * (never leaking internal details to the client).
 */
import type { Context } from "hono";
import type { ErrorBody } from "../api/types.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
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
    `模型 ${modelId} 还没有可用的 API key，请先在「模型」页为它配置。`,
  );
}

/** app.onError handler: maps HttpError through as-is; everything else is logged and converged to 500. */
export function handleError(err: Error, c: Context): Response {
  if (err instanceof HttpError) {
    return c.json(errorBody(err.code, err.message), err.status as 400);
  }
  // Unknown error: print the stack for diagnosis, but never expose details externally.
  console.error(`[server] 未处理异常: ${err.stack ?? err.message}`);
  return c.json(errorBody("internal", "服务器内部错误。"), 500);
}
