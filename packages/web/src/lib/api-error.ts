/**
 * API error → display text: the server's `{error:{code,message}}` message is
 * **English-only**, but the UI language may be Chinese — so for any error the
 * user might actually hit, we derive localized text from the **code** (the two
 * context-dependent cases below, then the S.errors.byCode table); the raw
 * server message is only a fallback for codes we haven't mapped yet.
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
  // These two need context the error body doesn't carry (the model id) / their own phrasing.
  if (err.code === "model_credential_missing") {
    return ctx?.modelId ? S.errors.modelCredentialMissing(ctx.modelId) : err.message;
  }
  if (err.code === "no_default_model") return S.errors.noDefaultModel;
  // Code → localized text; the map is a plain object, indexed by the runtime code string.
  const byCode = S.errors.byCode as Record<string, string | undefined>;
  return byCode[err.code] ?? err.message;
}
