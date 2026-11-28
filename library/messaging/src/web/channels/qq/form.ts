/**
 * QQ's form logic: Feishu's App ID and App Secret pair minus the domain field — the platform
 * has one host, so there is nothing for a domain to switch between. Pure, unit-tested without
 * a DOM.
 */
import type {
  QQBindingInfo,
  QQBindingPutRequest,
  QQTestRequest,
} from "@prismshadow/penguin-server/api";
import type { MessagingDeliveryFields, MessagingFormErrors } from "../channel-form";

export interface QQFormFields extends MessagingDeliveryFields {
  appId: string;
  /** Always starts empty; a non-empty value replaces the stored secret on save. */
  appSecret: string;
  /** The stored-secret clear checkbox (models idiom): applied on save, a typed secret wins over it. */
  clearSecret: boolean;
}

export function emptyQQFields(): QQFormFields {
  return {
    appId: "",
    appSecret: "",
    clearSecret: false,
    linePerMessage: false,
    finalReplyOnly: false,
    renderMarkdown: true,
  };
}

export function loadQQFields(info: QQBindingInfo): QQFormFields {
  return {
    appId: info.appId,
    appSecret: "",
    clearSecret: false,
    linePerMessage: info.linePerMessage,
    finalReplyOnly: info.finalReplyOnly,
    renderMarkdown: info.renderMarkdown,
  };
}

export function qqToPut(
  fields: QQFormFields,
  hasStoredSecret: boolean,
): { ok: true; body: QQBindingPutRequest } | { ok: false; errors: MessagingFormErrors } {
  const errors: MessagingFormErrors = {};
  const appId = fields.appId.trim();
  if (appId === "") errors.appId = "required";
  const appSecret = fields.appSecret.trim();
  const clearing = appSecret === "" && fields.clearSecret && hasStoredSecret;
  if (appSecret === "" && !hasStoredSecret) errors.appSecret = "required";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      appId,
      ...(appSecret !== "" ? { appSecret } : {}),
      ...(clearing ? { clearAppSecret: true } : {}),
      // Always sent, for the same reason as the other channels': an omitted flag means "keep".
      linePerMessage: fields.linePerMessage,
      finalReplyOnly: fields.finalReplyOnly,
      renderMarkdown: fields.renderMarkdown,
    },
  };
}

export function qqToTest(fields: QQFormFields): QQTestRequest {
  const appId = fields.appId.trim();
  const appSecret = fields.appSecret.trim();
  return {
    ...(appId !== "" ? { appId } : {}),
    ...(appSecret !== "" ? { appSecret } : {}),
  };
}

export function qqDirty(fields: QQFormFields, baseline: QQFormFields): boolean {
  return (
    fields.appId !== baseline.appId ||
    fields.appSecret.trim() !== "" ||
    fields.clearSecret ||
    fields.linePerMessage !== baseline.linePerMessage ||
    fields.finalReplyOnly !== baseline.finalReplyOnly ||
    fields.renderMarkdown !== baseline.renderMarkdown
  );
}

/** A draft needs both halves of the credential pair. */
export function qqTestable(fields: QQFormFields, secretConfigured: boolean): boolean {
  return (fields.appId.trim() !== "" && fields.appSecret.trim() !== "") || secretConfigured;
}
