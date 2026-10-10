/**
 * The API error the app's client throws, reproduced with the same shape so everything that
 * catches an `ApiError` in the app (toasts, the 401 sign-out, the per-code messages) works
 * unchanged against the mock. Its own module because both the router and the client need it.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The code an unrouted request answers with — what the coverage test looks for. */
export const UNMOCKED = "gallery_unmocked";

/** The code a write the demo refuses answers with: the app shows it as an ordinary failure toast. */
export const READ_ONLY = "demo_read_only";
