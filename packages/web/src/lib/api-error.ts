/**
 * API error → display text: the server's message is hardcoded in Chinese
 * (`{error:{code,message}}`), but the UI language may be English — so for any
 * error the user might actually hit, we derive localized text from **code**;
 * the server message is only a fallback for unknown codes.
 */
import { ApiError } from "../api/client";
import { S } from "./strings";

/**
 * ctx supplies context needed for localized text (e.g. the model id for a
 * missing key — the error body only has the code; the model id is filled in
 * by the caller: the model used by the current session/draft when sending).
 */
export function apiErrorText(err: unknown, ctx?: { modelId?: string }): string {
  if (!(err instanceof ApiError)) return S.common.unknownError;
  switch (err.code) {
    case "model_credential_missing":
      return ctx?.modelId ? S.errors.modelCredentialMissing(ctx.modelId) : err.message;
    case "no_default_model":
      return S.errors.noDefaultModel;
    default:
      return err.message;
  }
}
