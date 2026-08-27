/**
 * Messaging binding form helpers — conversion between the channel-aware editor's editable
 * state and the per-channel PUT/test DTOs (pure logic, unit-tested without a DOM; the
 * mcp-servers-form convention). The form keeps one sub-state per channel so switching the
 * selector back and forth never loses what was typed; `channel` names the selected one,
 * and only its fields are validated or submitted.
 *
 * QQ's sub-state mirrors Feishu's minus the domain field: the platform has one host, so
 * there is nothing for a domain to switch between.
 *
 * Not every field is a credential: `linePerMessage` (send a reply one message per non-blank
 * line), `finalReplyOnly` (send only a run's last reply, when the run ends) and
 * `renderMarkdown` (render its Markdown in the channel's own markup) are per-binding
 * delivery preferences that ride the same Save as the rest, which is why they live in the form
 * state rather than behind toggles of their own.
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
  QQBindingPutRequest,
  QQTestRequest,
  TelegramBindingPutRequest,
  TelegramTestRequest,
} from "@prismshadow/penguin-server/api";

/** Default Feishu open-platform domain (shown prefilled; Lark tenants overwrite it). */
export const FEISHU_DEFAULT_DOMAIN = "https://open.feishu.cn";

/** The token shape @BotFather issues — mirrors the server's identity rule, for immediate feedback. */
const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{5,}$/;

/**
 * The delivery preferences every channel carries — the saved fields that are not credentials,
 * identical in meaning on every channel, which is what lets one row render each of them
 * whichever channel is selected.
 */
export interface MessagingDeliveryFields {
  /** Deliver a reply as one message per non-blank line. */
  linePerMessage: boolean;
  /** Deliver only a run's LAST completed reply, at the run's end, instead of each as it completes. */
  finalReplyOnly: boolean;
  /** Render a reply's Markdown in this channel's own markup instead of sending its characters. */
  renderMarkdown: boolean;
}

export interface FeishuFormFields extends MessagingDeliveryFields {
  appId: string;
  /** Always starts empty; a non-empty value replaces the stored secret on save. */
  appSecret: string;
  baseDomain: string;
  /** The stored-secret clear checkbox (models idiom): applied on save, a typed secret wins over it. */
  clearSecret: boolean;
}

export interface QQFormFields extends MessagingDeliveryFields {
  appId: string;
  /** Always starts empty; a non-empty value replaces the stored secret on save. */
  appSecret: string;
  /** The stored-secret clear checkbox (models idiom): applied on save, a typed secret wins over it. */
  clearSecret: boolean;
}

export interface TelegramFormFields extends MessagingDeliveryFields {
  /** Always starts empty; a non-empty value replaces the stored token on save. */
  botToken: string;
  /** The stored-token clear checkbox (models idiom): applied on save, a typed token wins over it. */
  clearToken: boolean;
}

/** Editable state backing the binding editor: the selected channel plus every channel's fields. */
export interface MessagingFormState {
  channel: MessagingChannel;
  feishu: FeishuFormFields;
  telegram: TelegramFormFields;
  qq: QQFormFields;
}

export type MessagingFormField = "appId" | "appSecret" | "baseDomain" | "botToken";

export type MessagingFormErrorCode = "required" | "url_invalid" | "token_invalid";

export type MessagingFormErrors = Partial<Record<MessagingFormField, MessagingFormErrorCode>>;

/** A valid submit names its channel so the caller picks that channel's endpoint. */
export type MessagingFormResult =
  | { ok: true; channel: "feishu"; body: FeishuBindingPutRequest }
  | { ok: true; channel: "telegram"; body: TelegramBindingPutRequest }
  | { ok: true; channel: "qq"; body: QQBindingPutRequest }
  | { ok: false; errors: MessagingFormErrors };

export type MessagingTestRequestByChannel =
  | { channel: "feishu"; body: FeishuTestRequest }
  | { channel: "telegram"; body: TelegramTestRequest }
  | { channel: "qq"; body: QQTestRequest };

export function emptyMessagingForm(channel: MessagingChannel = "feishu"): MessagingFormState {
  return {
    channel,
    // `renderMarkdown` starts ON, matching what the server gives a binding created without
    // an opinion: a reply's Markdown is meant to render, and raw `**bold**` was the defect.
    feishu: {
      appId: "",
      appSecret: "",
      baseDomain: FEISHU_DEFAULT_DOMAIN,
      clearSecret: false,
      linePerMessage: false,
      finalReplyOnly: false,
      renderMarkdown: true,
    },
    telegram: {
      botToken: "",
      clearToken: false,
      linePerMessage: false,
      finalReplyOnly: false,
      renderMarkdown: true,
    },
    qq: {
      appId: "",
      appSecret: "",
      clearSecret: false,
      linePerMessage: false,
      finalReplyOnly: false,
      renderMarkdown: true,
    },
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
        linePerMessage: info.linePerMessage,
        finalReplyOnly: info.finalReplyOnly,
        renderMarkdown: info.renderMarkdown,
      };
    } else if (info.channel === "qq") {
      form.qq = {
        appId: info.appId,
        appSecret: "",
        clearSecret: false,
        linePerMessage: info.linePerMessage,
        finalReplyOnly: info.finalReplyOnly,
        renderMarkdown: info.renderMarkdown,
      };
    } else {
      // Telegram's only credential field is the secret itself, so its sub-state loads empty
      // apart from the delivery preferences, which are not credentials.
      form.telegram = {
        botToken: "",
        clearToken: false,
        linePerMessage: info.linePerMessage,
        finalReplyOnly: info.finalReplyOnly,
        renderMarkdown: info.renderMarkdown,
      };
    }
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
        // Always sent, unlike the credential fields: an omitted flag means "keep", which
        // would make turning either option back off impossible.
        linePerMessage: form.telegram.linePerMessage,
        finalReplyOnly: form.telegram.finalReplyOnly,
        renderMarkdown: form.telegram.renderMarkdown,
      },
    };
  }
  if (form.channel === "qq") {
    const appId = form.qq.appId.trim();
    if (appId === "") errors.appId = "required";
    const appSecret = form.qq.appSecret.trim();
    const clearing = appSecret === "" && form.qq.clearSecret && hasStoredSecret;
    if (appSecret === "" && !hasStoredSecret) errors.appSecret = "required";
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return {
      ok: true,
      channel: "qq",
      body: {
        appId,
        ...(appSecret !== "" ? { appSecret } : {}),
        ...(clearing ? { clearAppSecret: true } : {}),
        // Always sent, for the same reason as the other channels': an omitted flag means "keep".
        linePerMessage: form.qq.linePerMessage,
        finalReplyOnly: form.qq.finalReplyOnly,
        renderMarkdown: form.qq.renderMarkdown,
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
      // Always sent, for the same reason as Telegram's: an omitted flag means "keep".
      linePerMessage: form.feishu.linePerMessage,
      finalReplyOnly: form.feishu.finalReplyOnly,
      renderMarkdown: form.feishu.renderMarkdown,
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
  if (form.channel === "qq") {
    const appId = form.qq.appId.trim();
    const appSecret = form.qq.appSecret.trim();
    return {
      channel: "qq",
      body: {
        ...(appId !== "" ? { appId } : {}),
        ...(appSecret !== "" ? { appSecret } : {}),
      },
    };
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
 * typed secret always counts — it always loads empty — and so does a checked clear box, and
 * so does either delivery preference, which are the only edits a Telegram form can otherwise
 * have nothing to show for).
 */
export function formDirty(form: MessagingFormState, baseline: MessagingFormState): boolean {
  if (form.channel === "telegram") {
    return (
      form.telegram.botToken.trim() !== "" ||
      form.telegram.clearToken ||
      form.telegram.linePerMessage !== baseline.telegram.linePerMessage ||
      form.telegram.finalReplyOnly !== baseline.telegram.finalReplyOnly ||
      form.telegram.renderMarkdown !== baseline.telegram.renderMarkdown
    );
  }
  if (form.channel === "qq") {
    return (
      form.qq.appId !== baseline.qq.appId ||
      form.qq.appSecret.trim() !== "" ||
      form.qq.clearSecret ||
      form.qq.linePerMessage !== baseline.qq.linePerMessage ||
      form.qq.finalReplyOnly !== baseline.qq.finalReplyOnly ||
      form.qq.renderMarkdown !== baseline.qq.renderMarkdown
    );
  }
  return (
    form.feishu.appId !== baseline.feishu.appId ||
    form.feishu.baseDomain !== baseline.feishu.baseDomain ||
    form.feishu.appSecret.trim() !== "" ||
    form.feishu.clearSecret ||
    form.feishu.linePerMessage !== baseline.feishu.linePerMessage ||
    form.feishu.finalReplyOnly !== baseline.feishu.finalReplyOnly ||
    form.feishu.renderMarkdown !== baseline.feishu.renderMarkdown
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
  if (form.channel === "qq") {
    return (form.qq.appId.trim() !== "" && form.qq.appSecret.trim() !== "") || secretConfigured;
  }
  return (
    (form.feishu.appId.trim() !== "" && form.feishu.appSecret.trim() !== "") || secretConfigured
  );
}
