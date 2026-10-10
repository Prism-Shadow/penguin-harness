/**
 * The two ways a call can fail besides the transport itself (a network failure or an abort
 * surfaces as `fetch` raised it): the server refused the request before any stream began, or the
 * stream it began broke the protocol.
 */

/**
 * A refusal before the stream: the server answered with an error status and AMSP's error
 * envelope, `{"error": {"code": "<snake_case>", "message": "<text>"}}`.
 */
export class AmspHttpError extends Error {
  /** The HTTP status, such as `401`, `404` or `409`. */
  readonly status: number;
  /** The envelope's stable snake_case code; `http_error` when the body was not the envelope. */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AmspHttpError";
    this.status = status;
    this.code = code;
  }
}

/**
 * The stream ended or broke before `run.done`, or carried a block that is not an AMSP event: the
 * connection failed or the server did. The run's outcome is unknown; read the Session to learn
 * what happened to it.
 */
export class AmspStreamError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AmspStreamError";
  }
}

/**
 * The AmspHttpError an error response stands for: its envelope's code and message, or, for a
 * body that is not the envelope (a proxy's page, a different server), its status and the start
 * of its text.
 */
export async function httpError(response: Response): Promise<AmspHttpError> {
  const text = await response.text().catch(() => "");
  let error: unknown;
  try {
    error = (JSON.parse(text) as { error?: unknown } | null)?.error;
  } catch {
    error = undefined;
  }
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (typeof code === "string") {
    return new AmspHttpError(
      response.status,
      code,
      typeof message === "string" && message !== "" ? message : code,
    );
  }
  return new AmspHttpError(
    response.status,
    "http_error",
    `HTTP ${response.status}: ${text.slice(0, 200)}`,
  );
}
