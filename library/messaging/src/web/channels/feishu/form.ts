/**
 * Feishu's form logic: an App ID and App Secret pair plus the open-platform domain, which a
 * Lark tenant overwrites. Pure, unit-tested without a DOM.
 */
import type {
  FeishuBindingInfo,
  FeishuBindingPutRequest,
  FeishuTestRequest,
} from "@prismshadow/penguin-server/api";
import type { MessagingDeliveryFields, MessagingFormErrors } from "../channel-form";

/** Default Feishu open-platform domain (shown prefilled; Lark tenants overwrite it). */
export const FEISHU_DEFAULT_DOMAIN = "https://open.feishu.cn";

export interface FeishuFormFields extends MessagingDeliveryFields {
  appId: string;
  /** Always starts empty; a non-empty value replaces the stored secret on save. */
  appSecret: string;
  baseDomain: string;
  /** The stored-secret clear checkbox (models idiom): applied on save, a typed secret wins over it. */
  clearSecret: boolean;
}

export function emptyFeishuFields(): FeishuFormFields {
  // `renderMarkdown` starts ON, matching what the server gives a binding created without
  // an opinion: a reply's Markdown is meant to render, and raw `**bold**` was the defect.
  return {
    appId: "",
    appSecret: "",
    baseDomain: FEISHU_DEFAULT_DOMAIN,
    clearSecret: false,
    linePerMessage: false,
    finalReplyOnly: false,
    renderMarkdown: true,
  };
}

export function loadFeishuFields(info: FeishuBindingInfo): FeishuFormFields {
  return {
    appId: info.appId,
    appSecret: "",
    baseDomain: info.baseDomain,
    clearSecret: false,
    linePerMessage: info.linePerMessage,
    finalReplyOnly: info.finalReplyOnly,
    renderMarkdown: info.renderMarkdown,
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
 * The PUT body. A blank domain falls back to the default rather than erroring — the field is
 * prefilled, and clearing it is a "give me the default" gesture.
 */
export function feishuToPut(
  fields: FeishuFormFields,
  hasStoredSecret: boolean,
): { ok: true; body: FeishuBindingPutRequest } | { ok: false; errors: MessagingFormErrors } {
  const errors: MessagingFormErrors = {};
  const appId = fields.appId.trim();
  if (appId === "") errors.appId = "required";
  const appSecret = fields.appSecret.trim();
  const clearing = appSecret === "" && fields.clearSecret && hasStoredSecret;
  if (appSecret === "" && !hasStoredSecret) errors.appSecret = "required";
  const baseDomain = fields.baseDomain.trim() || FEISHU_DEFAULT_DOMAIN;
  if (!isHttpUrl(baseDomain)) errors.baseDomain = "url_invalid";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      appId,
      ...(appSecret !== "" ? { appSecret } : {}),
      ...(clearing ? { clearAppSecret: true } : {}),
      baseDomain,
      // Always sent, unlike the credential fields: an omitted flag means "keep", which
      // would make turning an option back off impossible.
      linePerMessage: fields.linePerMessage,
      finalReplyOnly: fields.finalReplyOnly,
      renderMarkdown: fields.renderMarkdown,
    },
  };
}

export function feishuToTest(fields: FeishuFormFields): FeishuTestRequest {
  const appId = fields.appId.trim();
  const appSecret = fields.appSecret.trim();
  const baseDomain = fields.baseDomain.trim();
  return {
    ...(appId !== "" ? { appId } : {}),
    ...(appSecret !== "" ? { appSecret } : {}),
    ...(baseDomain !== "" ? { baseDomain } : {}),
  };
}

export function feishuDirty(fields: FeishuFormFields, baseline: FeishuFormFields): boolean {
  return (
    fields.appId !== baseline.appId ||
    fields.baseDomain !== baseline.baseDomain ||
    fields.appSecret.trim() !== "" ||
    fields.clearSecret ||
    fields.linePerMessage !== baseline.linePerMessage ||
    fields.finalReplyOnly !== baseline.finalReplyOnly ||
    fields.renderMarkdown !== baseline.renderMarkdown
  );
}

/** A draft needs both halves of the credential pair. */
export function feishuTestable(fields: FeishuFormFields, secretConfigured: boolean): boolean {
  return (fields.appId.trim() !== "" && fields.appSecret.trim() !== "") || secretConfigured;
}
