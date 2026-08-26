/**
 * The Telegram Bot API seam: the four methods the Telegram connector uses (`getMe`,
 * `deleteWebhook`, `sendMessage`, `getUpdates`), behind an injectable transport so unit
 * tests substitute a fake and never open real network. Telegram needs no SDK — the Bot API is plain HTTPS
 * POSTs against https://api.telegram.org — so the production transport is a thin fetch
 * wrapper.
 *
 * Wire types below mirror the Bot API JSON verbatim (snake_case): the transport does not
 * reshape payloads, so a test fake constructs exactly what the real API returns.
 */

/** Telegram Bot API host. Deliberately not configurable: bindings carry only the token. */
export const TELEGRAM_API_BASE = "https://api.telegram.org";

/** One credential set (a binding's stored token, or a test request's draft). */
export interface TelegramCredentials {
  /** The whole credential: `<numeric bot id>:<secret>` as issued by @BotFather. */
  botToken: string;
}

/** `getMe` result — the slice of the Bot API `User` object the connector consumes. */
export interface TelegramBotUser {
  id: number;
  first_name?: string;
  username?: string;
}

/** The slice of a Bot API `Message` the connector consumes. */
export interface TelegramMessage {
  message_id: number;
  chat: {
    id: number;
    /** `private` for a direct chat with the bot; `group` / `supergroup` / `channel` otherwise. */
    type: string;
  };
  /** Present only for text messages; anything else (photo, sticker, voice, …) omits it. */
  text?: string;
  from?: {
    first_name?: string;
    username?: string;
  };
}

/** One `getUpdates` entry. Only `message` updates are processed; the rest are skipped. */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

/** Bot API half of the seam, bound to one token. Every method throws on failure with a readable reason. */
export interface TelegramBotClient {
  /** Credential probe: resolves the bot's own account (the test endpoint surfaces its username). */
  getMe(): Promise<TelegramBotUser>;
  /**
   * Drops any webhook registered on the bot, keeping pending updates. A webhook and
   * `getUpdates` are mutually exclusive on the Bot API, so a bot that was pointed at one
   * before it was bound here can never be polled until this runs. A no-op on a bot that
   * has no webhook.
   */
  deleteWebhook(): Promise<void>;
  /** Sends a text message into a chat; `replyToMessageId` threads it under an inbound message. */
  sendMessage(args: { chatId: string; text: string; replyToMessageId?: number }): Promise<void>;
  /**
   * Long-poll for updates: blocks up to `timeoutSec` (0 = return immediately) and resolves
   * the pending updates at or after `offset` (confirming everything before it; -1 means
   * "the newest update only", the connector's connect-time backlog drain). `signal` aborts
   * an in-flight poll when the connection closes.
   */
  getUpdates(args: {
    offset?: number;
    timeoutSec: number;
    signal: AbortSignal;
  }): Promise<TelegramUpdate[]>;
}

/** Factory the Telegram connector is built over: the production fetch adapter, or a test fake. */
export interface TelegramTransport {
  createClient(creds: TelegramCredentials): TelegramBotClient;
}

// ---------------------------------------------------------------------------
// Production adapter over fetch
// ---------------------------------------------------------------------------

/** Overall per-request deadline for the short calls (getMe / sendMessage / the drain). */
const CALL_TIMEOUT_MS = 15_000;

/** The `{ok, result, description, error_code}` envelope every Bot API response carries. */
interface TelegramEnvelope<T> {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/**
 * The two 409s a Bot API caller can actually act on, rewritten to lead with the action.
 * Telegram's own wording buries it — "Conflict: terminated by other getUpdates request;
 * make sure that only one bot instance is running" reads as an internal detail until the
 * end of the sentence, and a status line has room for a few words, not a paragraph. Any
 * other description passes through untouched.
 */
function conflictText(description: string): string | null {
  if (/terminated by other getUpdates/i.test(description)) {
    return "another program is already polling this bot — one bot token can serve only one PenguinHarness server at a time";
  }
  if (/webhook is active/i.test(description)) {
    return "a webhook is set on this bot, which blocks polling — remove it and re-enable the connection";
  }
  return null;
}

/**
 * Readable failure text out of fetch's throw shapes. The request URL embeds the bot
 * token, so nothing here may echo the URL — only the cause's own message (connect/DNS
 * errors name the address, never the path).
 */
function fetchErrorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "request timed out";
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message !== "") return cause.message;
    return err.message;
  }
  return String(err);
}

/** The production factory: plain HTTPS against the Bot API. */
export function createTelegramTransport(): TelegramTransport {
  return {
    createClient(creds: TelegramCredentials): TelegramBotClient {
      const call = async <T>(
        method: string,
        payload: Record<string, unknown>,
        opts?: { signal?: AbortSignal; timeoutMs?: number },
      ): Promise<T> => {
        const deadline = AbortSignal.timeout(opts?.timeoutMs ?? CALL_TIMEOUT_MS);
        const signal = opts?.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
        let res: Response;
        try {
          res = await fetch(`${TELEGRAM_API_BASE}/bot${creds.botToken}/${method}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal,
          });
        } catch (err) {
          throw new Error(`${method} failed: ${fetchErrorText(err)}`);
        }
        const body = (await res.json().catch(() => null)) as TelegramEnvelope<T> | null;
        if (body === null || body.ok !== true) {
          const described = body?.description;
          const detail =
            (described !== undefined ? conflictText(described) : null) ??
            described ??
            `HTTP ${res.status}`;
          const code = body?.error_code !== undefined ? ` (code ${body.error_code})` : "";
          throw new Error(`${method} failed: ${detail}${code}`);
        }
        return body.result as T;
      };

      // Chat ids are stored as text; the API wants the numeric form back (a string works
      // for @channel usernames only), so safe integers are converted.
      const wireChatId = (chatId: string): number | string => {
        const n = Number(chatId);
        return Number.isSafeInteger(n) && chatId.trim() !== "" ? n : chatId;
      };

      return {
        getMe: () => call<TelegramBotUser>("getMe", {}),
        async deleteWebhook(): Promise<void> {
          // drop_pending_updates stays false: the connector's own backlog drain decides
          // what counts as the dark period, and dropping here would pre-empt it.
          await call("deleteWebhook", { drop_pending_updates: false });
        },
        async sendMessage({ chatId, text, replyToMessageId }): Promise<void> {
          await call("sendMessage", {
            chat_id: wireChatId(chatId),
            text,
            // Degrade to a plain send when the replied-to message is gone, rather than fail.
            ...(replyToMessageId !== undefined
              ? {
                  reply_parameters: {
                    message_id: replyToMessageId,
                    allow_sending_without_reply: true,
                  },
                }
              : {}),
          });
        },
        getUpdates: ({ offset, timeoutSec, signal }) =>
          call<TelegramUpdate[]>(
            "getUpdates",
            {
              timeout: timeoutSec,
              allowed_updates: ["message"],
              ...(offset !== undefined ? { offset } : {}),
            },
            // The overall deadline must outlive the server-side long poll.
            { signal, timeoutMs: (timeoutSec + 15) * 1000 },
          ),
      };
    },
  };
}
