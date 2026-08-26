/**
 * Messaging binding form helpers — conversion between the channel-aware editor's editable
 * state and the per-channel PUT/test DTOs (pure logic, unit-tested without a DOM; the
 * mcp-servers-form convention). The form keeps one sub-state per channel so switching the
 * selector back and forth never loses what was typed; `channel` names the selected one,
 * and only its fields are validated or submitted.
 *
 * Secrets never round-trip: `bindingToForm` always leaves the secret field empty (the
 * server only ever returns a masked value), and `formToPut` omits a blank one so the
 * server keeps the stored value. Validation errors come back as codes; the component maps
 * them to localized messages.
 */
import type {
  FeishuBindingPutRequest,
  FeishuTestRequest,
  MessagingBindingInfo,
  MessagingChannel,
  TelegramBindingPutRequest,
  TelegramTestRequest,
} from "@prismshadow/penguin-server/api";

/** Default Feishu open-platform domain (shown prefilled; Lark tenants overwrite it). */
export const FEISHU_DEFAULT_DOMAIN = "https://open.feishu.cn";

/** The token shape @BotFather issues — mirrors the server's identity rule, for immediate feedback. */
const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{5,}$/;

export interface FeishuFormFields {
  appId: string;
  /** Always starts empty; a non-empty value replaces the stored secret on save. */
  appSecret: string;
  baseDomain: string;
  /** The stored-secret clear checkbox (models idiom): applied on save, a typed secret wins over it. */
  clearSecret: boolean;
}

export interface TelegramFormFields {
  /** Always starts empty; a non-empty value replaces the stored token on save. */
  botToken: string;
  /** The stored-token clear checkbox (models idiom): applied on save, a typed token wins over it. */
  clearToken: boolean;
}

/** Editable state backing the binding editor: the selected channel plus both channels' fields. */
export interface MessagingFormState {
  channel: MessagingChannel;
  feishu: FeishuFormFields;
  telegram: TelegramFormFields;
}

export type MessagingFormField = "appId" | "appSecret" | "baseDomain" | "botToken";

export type MessagingFormErrorCode = "required" | "url_invalid" | "token_invalid";

export type MessagingFormErrors = Partial<Record<MessagingFormField, MessagingFormErrorCode>>;

/** A valid submit names its channel so the caller picks that channel's endpoint. */
export type MessagingFormResult =
  | { ok: true; channel: "feishu"; body: FeishuBindingPutRequest }
  | { ok: true; channel: "telegram"; body: TelegramBindingPutRequest }
  | { ok: false; errors: MessagingFormErrors };

export type MessagingTestRequestByChannel =
  | { channel: "feishu"; body: FeishuTestRequest }
  | { channel: "telegram"; body: TelegramTestRequest };

export function emptyMessagingForm(channel: MessagingChannel = "feishu"): MessagingFormState {
  return {
    channel,
    feishu: { appId: "", appSecret: "", baseDomain: FEISHU_DEFAULT_DOMAIN, clearSecret: false },
    telegram: { botToken: "", clearToken: false },
  };
}

/**
 * Builds the editor's form from every saved config: each channel's non-secret fields
 * load (secrets stay empty — masked values never round-trip — and clear checkboxes start
 * unchecked), and the selector starts on the enabled channel, else the first saved one,
 * else Feishu.
 */
export function bindingsToForm(bindings: MessagingBindingInfo[]): MessagingFormState {
  const enabled = bindings.find((b) => b.enabled)?.channel;
  const form = emptyMessagingForm(enabled ?? bindings[0]?.channel ?? "feishu");
  for (const info of bindings) {
    if (info.channel === "feishu") {
      form.feishu = {
        appId: info.appId,
        appSecret: "",
        baseDomain: info.baseDomain,
        clearSecret: false,
      };
    }
    // Telegram's one field is the secret itself, so its sub-state always loads empty.
  }
  return form;
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
 * Validates the selected channel's fields and builds its PUT body. `hasStoredSecret`
 * relaxes the secret requirement: with a saved binding an empty field means "keep it",
 * on a first bind it is an error. A blank Feishu domain falls back to the default rather
 * than erroring — the field is prefilled, and clearing it is a "give me the default"
 * gesture.
 */
export function formToPut(form: MessagingFormState, hasStoredSecret: boolean): MessagingFormResult {
  const errors: MessagingFormErrors = {};
  if (form.channel === "telegram") {
    const botToken = form.telegram.botToken.trim();
    // A typed token wins over a stale clear checkbox (the models idiom).
    const clearing = botToken === "" && form.telegram.clearToken && hasStoredSecret;
    if (botToken === "" && !hasStoredSecret) errors.botToken = "required";
    else if (botToken !== "" && !TELEGRAM_TOKEN_RE.test(botToken)) {
      errors.botToken = "token_invalid";
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return {
      ok: true,
      channel: "telegram",
      body: {
        ...(botToken !== "" ? { botToken } : {}),
        ...(clearing ? { clearBotToken: true } : {}),
      },
    };
  }
  const appId = form.feishu.appId.trim();
  if (appId === "") errors.appId = "required";
  const appSecret = form.feishu.appSecret.trim();
  const clearing = appSecret === "" && form.feishu.clearSecret && hasStoredSecret;
  if (appSecret === "" && !hasStoredSecret) errors.appSecret = "required";
  const baseDomain = form.feishu.baseDomain.trim() || FEISHU_DEFAULT_DOMAIN;
  if (!isHttpUrl(baseDomain)) errors.baseDomain = "url_invalid";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    channel: "feishu",
    body: {
      appId,
      ...(appSecret !== "" ? { appSecret } : {}),
      ...(clearing ? { clearAppSecret: true } : {}),
      baseDomain,
    },
  };
}

/**
 * The credential test's request: only the fields the form actually carries — omitted ones
 * fall back to the stored binding server-side, so testing a saved binding needs no
 * re-typed secret.
 */
export function formToTest(form: MessagingFormState): MessagingTestRequestByChannel {
  if (form.channel === "telegram") {
    const botToken = form.telegram.botToken.trim();
    return { channel: "telegram", body: { ...(botToken !== "" ? { botToken } : {}) } };
  }
  const appId = form.feishu.appId.trim();
  const appSecret = form.feishu.appSecret.trim();
  const baseDomain = form.feishu.baseDomain.trim();
  return {
    channel: "feishu",
    body: {
      ...(appId !== "" ? { appId } : {}),
      ...(appSecret !== "" ? { appSecret } : {}),
      ...(baseDomain !== "" ? { baseDomain } : {}),
    },
  };
}

/**
 * Unsaved edits on the selected channel: any field differing from the loaded baseline (a
 * typed secret always counts — it always loads empty — and so does a checked clear box).
 */
export function formDirty(form: MessagingFormState, baseline: MessagingFormState): boolean {
  if (form.channel === "telegram") {
    return form.telegram.botToken.trim() !== "" || form.telegram.clearToken;
  }
  return (
    form.feishu.appId !== baseline.feishu.appId ||
    form.feishu.baseDomain !== baseline.feishu.baseDomain ||
    form.feishu.appSecret.trim() !== "" ||
    form.feishu.clearSecret
  );
}

/**
 * The credential probe needs a testable credential: the selected channel's draft, or its
 * stored secret (`secretConfigured` — a stored config whose secret was cleared has
 * nothing to probe).
 */
export function formTestable(form: MessagingFormState, secretConfigured: boolean): boolean {
  if (form.channel === "telegram") {
    return form.telegram.botToken.trim() !== "" || secretConfigured;
  }
  return (
    (form.feishu.appId.trim() !== "" && form.feishu.appSecret.trim() !== "") || secretConfigured
  );
}
