/**
 * WeChat's form logic. The channel has no credential to type — its bot token comes only from a
 * scan, which writes it server-side — so its sub-state is the delivery preferences plus the
 * clear checkbox, and its submit can never fail validation. Pure, unit-tested without a DOM.
 */
import type { WeChatBindingInfo, WeChatBindingPutRequest } from "@prismshadow/penguin-server/api";
import type { MessagingDeliveryFields, MessagingFormErrors } from "../channel-form";

/**
 * WeChat's editable state: the delivery preferences, and the clear checkbox.
 *
 * No credential field, because there is nothing to type — the bot token arrives from a scan
 * and is stored without ever passing through this form.
 */
export interface WeChatFormFields extends MessagingDeliveryFields {
  /** The stored-token clear checkbox (models idiom): applied on save. */
  clearToken: boolean;
}

export function emptyWeChatFields(): WeChatFormFields {
  return {
    clearToken: false,
    linePerMessage: false,
    finalReplyOnly: false,
    renderMarkdown: true,
  };
}

/** Nothing but preferences loads: this channel's only credential is the token, which the form never holds. */
export function loadWeChatFields(info: WeChatBindingInfo): WeChatFormFields {
  return {
    clearToken: false,
    linePerMessage: info.linePerMessage,
    finalReplyOnly: info.finalReplyOnly,
    renderMarkdown: info.renderMarkdown,
  };
}

/** The one submit that cannot fail: there is no field to leave blank or to mistype. */
export function wechatToPut(
  fields: WeChatFormFields,
  hasStoredSecret: boolean,
): { ok: true; body: WeChatBindingPutRequest } | { ok: false; errors: MessagingFormErrors } {
  return {
    ok: true,
    body: {
      ...(fields.clearToken && hasStoredSecret ? { clearBotToken: true } : {}),
      // Always sent, for the same reason as the other channels': an omitted flag means "keep".
      linePerMessage: fields.linePerMessage,
      finalReplyOnly: fields.finalReplyOnly,
      renderMarkdown: fields.renderMarkdown,
    },
  };
}

/** No draft to send: this channel's probe reads the stored binding. */
export function wechatToTest(): undefined {
  return undefined;
}

export function wechatDirty(fields: WeChatFormFields, baseline: WeChatFormFields): boolean {
  return (
    fields.clearToken ||
    fields.linePerMessage !== baseline.linePerMessage ||
    fields.finalReplyOnly !== baseline.finalReplyOnly ||
    fields.renderMarkdown !== baseline.renderMarkdown
  );
}

/** WeChat has no draft to probe: only a stored token can be tested. */
export function wechatTestable(_fields: WeChatFormFields, secretConfigured: boolean): boolean {
  return secretConfigured;
}
