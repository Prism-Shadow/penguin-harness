/**
 * Telegram's form logic: the whole credential is one Bot Token, so the sub-state is that token,
 * its clear checkbox and the delivery preferences. Pure, unit-tested without a DOM.
 */
import type {
  TelegramBindingInfo,
  TelegramBindingPutRequest,
  TelegramTestRequest,
} from "@prismshadow/penguin-server/api";
import type { MessagingDeliveryFields, MessagingFormErrors } from "../channel-form";

/** The token shape @BotFather issues — mirrors the server's identity rule, for immediate feedback. */
const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{5,}$/;

export interface TelegramFormFields extends MessagingDeliveryFields {
  /** Always starts empty; a non-empty value replaces the stored token on save. */
  botToken: string;
  /** The stored-token clear checkbox (models idiom): applied on save, a typed token wins over it. */
  clearToken: boolean;
}

export function emptyTelegramFields(): TelegramFormFields {
  return {
    botToken: "",
    clearToken: false,
    linePerMessage: false,
    finalReplyOnly: false,
    renderMarkdown: true,
  };
}

/**
 * Telegram's only credential field is the secret itself, so its sub-state loads empty apart
 * from the delivery preferences, which are not credentials.
 */
export function loadTelegramFields(info: TelegramBindingInfo): TelegramFormFields {
  return {
    botToken: "",
    clearToken: false,
    linePerMessage: info.linePerMessage,
    finalReplyOnly: info.finalReplyOnly,
    renderMarkdown: info.renderMarkdown,
  };
}

export function telegramToPut(
  fields: TelegramFormFields,
  hasStoredSecret: boolean,
): { ok: true; body: TelegramBindingPutRequest } | { ok: false; errors: MessagingFormErrors } {
  const errors: MessagingFormErrors = {};
  const botToken = fields.botToken.trim();
  // A typed token wins over a stale clear checkbox (the models idiom).
  const clearing = botToken === "" && fields.clearToken && hasStoredSecret;
  if (botToken === "" && !hasStoredSecret) errors.botToken = "required";
  else if (botToken !== "" && !TELEGRAM_TOKEN_RE.test(botToken)) {
    errors.botToken = "token_invalid";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      ...(botToken !== "" ? { botToken } : {}),
      ...(clearing ? { clearBotToken: true } : {}),
      // Always sent, unlike the credential fields: an omitted flag means "keep", which
      // would make turning either option back off impossible.
      linePerMessage: fields.linePerMessage,
      finalReplyOnly: fields.finalReplyOnly,
      renderMarkdown: fields.renderMarkdown,
    },
  };
}

export function telegramToTest(fields: TelegramFormFields): TelegramTestRequest {
  const botToken = fields.botToken.trim();
  return { ...(botToken !== "" ? { botToken } : {}) };
}

/**
 * The token field always loads empty, so a typed token and a checked clear box are the dirty
 * signals — and either delivery preference, which are the only edits a Telegram form can
 * otherwise have nothing to show for.
 */
export function telegramDirty(fields: TelegramFormFields, baseline: TelegramFormFields): boolean {
  return (
    fields.botToken.trim() !== "" ||
    fields.clearToken ||
    fields.linePerMessage !== baseline.linePerMessage ||
    fields.finalReplyOnly !== baseline.finalReplyOnly ||
    fields.renderMarkdown !== baseline.renderMarkdown
  );
}

/** The token is the whole credential. */
export function telegramTestable(fields: TelegramFormFields, secretConfigured: boolean): boolean {
  return fields.botToken.trim() !== "" || secretConfigured;
}
