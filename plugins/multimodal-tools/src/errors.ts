import type { EmptyResponseError, UpstreamError, UsageMetadata } from "@prismshadow/mmsp";

/**
 * A refusal or failure this plugin reports: an HTTP status and a stable code, the shape the host's
 * own errors have (`{ error: { code, message } }`). The CLI prints the message; the routes answer
 * with the status.
 */
export class ToolError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export function badInput(message: string): ToolError {
  return new ToolError(400, "bad_request", message);
}

/**
 * The status, code and message of anything thrown: this plugin's ToolError, an error the host's
 * interfaces throw (its HttpError carries the same three fields), else a 500.
 */
export function errorFields(err: unknown): { status: number; code: string; message: string } {
  const e = err as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (
    e !== null &&
    typeof e === "object" &&
    typeof e.status === "number" &&
    e.status >= 400 &&
    e.status < 600 &&
    typeof e.code === "string" &&
    typeof e.message === "string"
  ) {
    return { status: e.status, code: e.code, message: e.message };
  }
  return { status: 500, code: "internal", message: "The multimodal tools failed unexpectedly." };
}

/** Dedicated transcription clients report a completed, empty string as MMSP's EmptyResponseError.
 * The host owns the client, so the plugin reads its public error fields across the module boundary. */
export function emptyTranscriptUsage(err: unknown): UsageMetadata | null | undefined {
  if (!(err instanceof Error)) return;
  const local = err as EmptyResponseError;
  const remote = err as UpstreamError;
  const result =
    err.name === "EmptyResponseError"
      ? {
          client: local.client,
          finish_reason: local.finishReason,
          usage_metadata: local.usageMetadata,
        }
      : err.name === "UpstreamError" &&
          remote.status === null &&
          remote.errorType === "EmptyResponseError"
        ? remote.error
        : undefined;
  if (
    result?.finish_reason !== "stop" ||
    (result.client !== "DeepSeekTranscriptionClient" &&
      result.client !== "OpenaiTranscriptionClient")
  )
    return;
  return (result.usage_metadata as UsageMetadata | null) ?? null;
}

/** A failure in words a person can act on; the provider's own message is not shown. */
export function failureReason(err: unknown): string {
  if (err instanceof ToolError) return err.message;
  const e = err as { name?: string; status?: number; code?: unknown; message?: unknown } | null;
  if (e?.name === "HttpError" && typeof e.message === "string") return e.message;
  if (e?.name === "ModelIdleTimeoutError" && typeof e.message === "string") return e.message;
  if (
    e?.name === "ApiKeyRequiredError" ||
    e?.name === "ModelCredentialError" ||
    e?.status === 401 ||
    e?.status === 403
  ) {
    return "The model provider rejected the credential. Check the model's or its group's key.";
  }
  if (e?.status === 429) return "The model provider rate-limited this request.";
  if (
    e?.name === "UnsupportedParameterError" ||
    e?.name === "UnsupportedOperationError" ||
    e?.name === "UnsupportedContentError"
  ) {
    return "The selected model does not support this operation or its options.";
  }
  if (typeof e?.status === "number" && e.status >= 400)
    return `The model provider returned HTTP ${e.status}.`;
  return "The model request failed. Check the selected model and its endpoint.";
}
