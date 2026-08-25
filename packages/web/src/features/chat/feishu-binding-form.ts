/**
 * Feishu binding form helpers — conversion between the dialog's editable state and the
 * PUT/test DTOs (pure logic, unit-tested without a DOM; the mcp-servers-form convention).
 *
 * The secret never round-trips: `bindingToForm` always leaves the field empty (the server
 * only ever returns a masked value), and `formToPut` omits a blank secret so the server
 * keeps the stored one. Validation errors come back as codes; the component maps them to
 * localized messages.
 */
import type {
  FeishuBindingInfo,
  FeishuBindingPutRequest,
  FeishuTestRequest,
} from "@prismshadow/penguin-server/api";

/** Default Feishu open-platform domain (shown prefilled; Lark tenants overwrite it). */
export const FEISHU_DEFAULT_DOMAIN = "https://open.feishu.cn";

/** Editable string state backing the binding dialog. */
export interface FeishuFormState {
  appId: string;
  /** Always starts empty; a non-empty value replaces the stored secret on save. */
  appSecret: string;
  baseDomain: string;
  enabled: boolean;
}

export type FeishuFormField = "appId" | "appSecret" | "baseDomain";

export type FeishuFormErrorCode = "required" | "url_invalid";

export type FeishuFormErrors = Partial<Record<FeishuFormField, FeishuFormErrorCode>>;

export type FeishuFormResult =
  { ok: true; body: FeishuBindingPutRequest } | { ok: false; errors: FeishuFormErrors };

export function emptyFeishuForm(): FeishuFormState {
  return { appId: "", appSecret: "", baseDomain: FEISHU_DEFAULT_DOMAIN, enabled: true };
}

/** Loads the stored binding into form state; the secret field stays empty (masked values never round-trip). */
export function bindingToForm(info: FeishuBindingInfo): FeishuFormState {
  return {
    appId: info.appId,
    appSecret: "",
    baseDomain: info.baseDomain,
    enabled: info.enabled,
  };
}

/** A syntactically valid http(s) URL (the server normalizes to the origin). */
function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates form state and builds the PUT body. `hasStoredSecret` relaxes the secret
 * requirement: with a saved binding an empty field means "keep it", on a first bind it is
 * an error. A blank domain falls back to the default rather than erroring — the field is
 * prefilled, and clearing it is a "give me the default" gesture.
 */
export function formToPut(form: FeishuFormState, hasStoredSecret: boolean): FeishuFormResult {
  const errors: FeishuFormErrors = {};
  const appId = form.appId.trim();
  if (appId === "") errors.appId = "required";
  const appSecret = form.appSecret.trim();
  if (appSecret === "" && !hasStoredSecret) errors.appSecret = "required";
  const baseDomain = form.baseDomain.trim() || FEISHU_DEFAULT_DOMAIN;
  if (!isHttpUrl(baseDomain)) errors.baseDomain = "url_invalid";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      appId,
      ...(appSecret !== "" ? { appSecret } : {}),
      baseDomain,
      enabled: form.enabled,
    },
  };
}

/**
 * The credential test's request: only the fields the form actually carries — omitted ones
 * fall back to the stored binding server-side, so testing a saved binding needs no
 * re-typed secret.
 */
export function formToTest(form: FeishuFormState): FeishuTestRequest {
  const appId = form.appId.trim();
  const appSecret = form.appSecret.trim();
  const baseDomain = form.baseDomain.trim();
  return {
    ...(appId !== "" ? { appId } : {}),
    ...(appSecret !== "" ? { appSecret } : {}),
    ...(baseDomain !== "" ? { baseDomain } : {}),
  };
}
