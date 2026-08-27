/**
 * The Telegram Bot API seam: the methods the Telegram connector uses (`getMe`,
 * `getWebhookInfo`, `sendMessage`, `getUpdates`, the file download behind an inbound photo,
 * and the `sendPhoto` / `sendDocument` uploads behind an outbound one),
 * behind an injectable transport so unit
 * tests substitute a fake and never open real network. Telegram needs no SDK — the Bot API is plain HTTPS
 * POSTs against https://api.telegram.org — so the production transport is a thin fetch
 * wrapper.
 *
 * Wire types below mirror the Bot API JSON verbatim (snake_case): the transport does not
 * reshape payloads, so a test fake constructs exactly what the real API returns.
 */
import { MessagingMediaTooLargeError, collectUnderCap } from "./media.js";

/** Telegram Bot API host. Deliberately not configurable: bindings carry only the token. */
export const TELEGRAM_API_BASE = "https://api.telegram.org";

/** One credential set (a binding's stored token, or a test request's draft). */
export interface TelegramCredentials {
  /** The whole credential: `<numeric bot id>:<secret>` as issued by @BotFather. */
  botToken: string;
}

/**
 * `getMe` result — the slice of the Bot API `User` object the connector consumes. The
 * capability flag is documented as "Returned only in getMe", so this is the one call that
 * can report it, and it may be absent from a response that predates it.
 */
export interface TelegramBotUser {
  id: number;
  first_name?: string;
  username?: string;
  /**
   * "True, if privacy mode is disabled for the bot." Privacy mode is ON for every bot whose
   * owner has not turned it off in @BotFather, and it silently withholds ordinary group
   * messages wherever the bot is not an administrator of the group — see the connector's
   * checkCredentials.
   */
  can_read_all_group_messages?: boolean;
}

/**
 * One entry of a message's `entities` array: a span over the text with a meaning attached.
 *
 * `offset` and `length` are counted in UTF-16 code units — which is exactly what a
 * JavaScript string index is, so a span applies with `slice(offset, offset + length)` and
 * nothing has to be converted anywhere in this codebase.
 */
export interface TelegramMessageEntity {
  /** `mention` (the span is a literal `@username`), `text_mention` (a user with no username, carried in `user`), `bold`, `code`, … */
  type: string;
  offset: number;
  length: number;
  /** Present on `text_mention` only: the user the span refers to, there being no `@username` in the text to match on. */
  user?: { id: number };
}

/**
 * One size variant of an inbound photo. The Bot API sends a photo as an ARRAY of these —
 * the same picture re-encoded at several resolutions — and the connector picks the largest,
 * which is the one the user actually sent.
 */
export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  /** The Bot API marks it optional, so the size comparison cannot rely on it alone. */
  file_size?: number;
}

/** The slice of a Bot API `Message` the connector consumes. */
export interface TelegramMessage {
  message_id: number;
  chat: {
    id: number;
    /** `private` for a direct chat with the bot; `group` / `supergroup` / `channel` otherwise. */
    type: string;
    /** "True, if the supergroup chat is a forum" — i.e. it is split into topics at all. */
    is_forum?: boolean;
  };
  /** Present only for text messages; anything else (photo, sticker, voice, …) omits it. */
  text?: string;
  /**
   * Spans over `text` (mentions, formatting, …); absent when the message has none. A
   * captioned media message carries the same shapes over its caption under
   * `caption_entities` instead — the day this connector reads captions, it reads that.
   */
  entities?: TelegramMessageEntity[];
  /**
   * "Unique identifier of a message thread or forum topic to which the message belongs; for
   * supergroups and private chats only."
   *
   * Inbound and outbound are NOT symmetric, and the difference is the whole reason
   * `is_topic_message` is read below. This field is also set on an ordinary reply chain — in
   * a private chat, and in a supergroup that is no forum — while `sendMessage`'s
   * `message_thread_id` is "for forum supergroups only" and answers anything else with
   * `Bad Request: message thread not found`. So a value seen here may only be sent back once
   * `chat.is_forum` and `is_topic_message` both say it names a forum topic.
   *
   * Absent in a forum supergroup's General topic — which is why absence has to mean "send
   * without a thread" rather than "send to General by id".
   */
  message_thread_id?: number;
  /**
   * "True, if the message is sent to a forum topic." Absent for a forum's General topic and
   * for the reply-chain `message_thread_id` above, which is exactly what tells the two apart.
   */
  is_topic_message?: boolean;
  /** Size variants of an inbound photo, smallest first; absent for every other message kind. */
  photo?: TelegramPhotoSize[];
  /** The text sent WITH a photo (or another media message) — a text message carries `text` instead. */
  caption?: string;
  from?: {
    first_name?: string;
    username?: string;
  };
}

/** The slice of `getFile`'s result the connector consumes. */
export interface TelegramFile {
  /**
   * Path to pass to the file endpoint (valid at least an hour). Optional on the wire: a
   * file the bot may not download resolves without one.
   */
  file_path?: string;
  file_size?: number;
}

/** A downloaded file: the bytes, plus the path they came from (its extension names the type). */
export interface TelegramFileBytes {
  data: Buffer;
  filePath: string;
}

/**
 * The slice of `getWebhookInfo`'s result the connector consumes. `url` is the empty string
 * when no webhook is registered — that is the Bot API's own encoding, not a normalization.
 */
export interface TelegramWebhookInfo {
  url: string;
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
   * Reports the webhook registered on the bot, if any. A webhook and `getUpdates` are
   * mutually exclusive on the Bot API, so a bot pointed at one cannot be polled at all
   * until it is removed — and removing it is the user's call, not this app's: the
   * registration belongs to whatever service they pointed it at, and clearing it here
   * would silently take that service off the air. Read-only on purpose; the connector
   * reports the URL and leaves the bot alone.
   */
  getWebhookInfo(): Promise<TelegramWebhookInfo>;
  /**
   * Sends a text message into a chat; `replyToMessageId` threads it under an inbound message,
   * and `messageThreadId` puts it in a forum topic. Without the latter a send lands in a forum
   * supergroup's General topic, wherever the conversation actually is — and with it anywhere
   * that is not a forum topic the call fails, the parameter being "for forum supergroups only".
   */
  sendMessage(args: {
    chatId: string;
    text: string;
    replyToMessageId?: number;
    messageThreadId?: number;
  }): Promise<void>;
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
  /**
   * Downloads a file the bot can see, in two hops: `getFile` resolves a path, and the FILE
   * endpoint serves the bytes. That second URL is not the method endpoint — it is
   * `/file/bot<token>/<file_path>` — and it embeds the bot token, so no failure here may
   * ever echo it (see fetchErrorText). Throws when the transfer fails or exceeds
   * `maxBytes`; the Bot API itself refuses to serve a bot anything over 20MB this way, so
   * whichever ceiling is lower is the one that bites.
   */
  getFileBytes(args: { fileId: string; maxBytes: number }): Promise<TelegramFileBytes>;
  /**
   * Sends a picture into a chat as a photo, so it renders inline. Multipart upload from
   * bytes rather than by URL — the file lives in a Workspace this server can read and
   * Telegram cannot.
   */
  sendPhoto(args: { chatId: string; fileName: string; data: Buffer }): Promise<void>;
  /** Sends any other file into a chat as a document (the attachment form). */
  sendDocument(args: { chatId: string; fileName: string; data: Buffer }): Promise<void>;
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

/**
 * Deadline for a file transfer, in either direction. Far longer than a method call: these
 * move megabytes over whatever link the server has, and a 15s ceiling would fail a picture
 * that was on its way perfectly well.
 */
const TRANSFER_TIMEOUT_MS = 60_000;

/** The `{ok, result, description, error_code}` envelope every Bot API response carries. */
interface TelegramEnvelope<T> {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/**
 * A Bot API call the server answered with `ok: false`, carrying Telegram's own `error_code`.
 *
 * The code is the only part of the envelope a caller may branch on: `description` is prose
 * Telegram rewords without notice, so a retry keyed on its wording breaks silently. A
 * transport failure — a timeout, a reset, an unparseable body — has no code and stays a
 * plain Error, which keeps "the request never completed" distinguishable from "Telegram
 * refused it"; nothing may retry the former, because the message may well have been
 * delivered.
 */
export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly errorCode: number | undefined,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
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
    return "a webhook is set on this bot, which blocks polling — remove it and the connection recovers on its own";
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

/**
 * A response body as chunks. `Response.body` is a web ReadableStream, which is only
 * async-iterable under some lib configurations; reading it through its reader works under
 * all of them. Cancelling on the way out matters for the capped read — a transfer aborted
 * over the ceiling must not leave the socket draining the rest of the file.
 */
async function* bodyChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value !== undefined) yield value;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** The production factory: plain HTTPS against the Bot API. */
export function createTelegramTransport(): TelegramTransport {
  return {
    createClient(creds: TelegramCredentials): TelegramBotClient {
      /** One Bot API method call: POST the body, then unwrap the `{ok, result}` envelope. */
      const send = async <T>(
        method: string,
        // The two body shapes this transport posts: a JSON string, or a multipart upload.
        body: string | FormData,
        headers: Record<string, string>,
        opts?: { signal?: AbortSignal; timeoutMs?: number },
      ): Promise<T> => {
        const deadline = AbortSignal.timeout(opts?.timeoutMs ?? CALL_TIMEOUT_MS);
        const signal = opts?.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
        let res: Response;
        try {
          res = await fetch(`${TELEGRAM_API_BASE}/bot${creds.botToken}/${method}`, {
            method: "POST",
            headers,
            body,
            signal,
          });
        } catch (err) {
          throw new Error(`${method} failed: ${fetchErrorText(err)}`);
        }
        const parsed = (await res.json().catch(() => null)) as TelegramEnvelope<T> | null;
        if (parsed === null || parsed.ok !== true) {
          const described = parsed?.description;
          const detail =
            (described !== undefined ? conflictText(described) : null) ??
            described ??
            `HTTP ${res.status}`;
          const code = parsed?.error_code !== undefined ? ` (code ${parsed.error_code})` : "";
          throw new TelegramApiError(`${method} failed: ${detail}${code}`, parsed?.error_code);
        }
        return parsed.result as T;
      };

      const call = <T>(
        method: string,
        payload: Record<string, unknown>,
        opts?: { signal?: AbortSignal; timeoutMs?: number },
      ): Promise<T> =>
        send<T>(method, JSON.stringify(payload), { "content-type": "application/json" }, opts);

      /**
       * A file-carrying call. No content-type is set on purpose: fetch derives the
       * multipart one from the FormData, boundary included, and a hand-written header
       * would name a boundary the body does not use.
       */
      const callForm = (method: string, form: FormData): Promise<unknown> =>
        send<unknown>(method, form, {}, { timeoutMs: TRANSFER_TIMEOUT_MS });

      // Chat ids are stored as text; the API wants the numeric form back (a string works
      // for @channel usernames only), so safe integers are converted.
      const wireChatId = (chatId: string): number | string => {
        const n = Number(chatId);
        return Number.isSafeInteger(n) && chatId.trim() !== "" ? n : chatId;
      };

      return {
        getMe: () => call<TelegramBotUser>("getMe", {}),
        getWebhookInfo: () => call<TelegramWebhookInfo>("getWebhookInfo", {}),
        async sendMessage({ chatId, text, replyToMessageId, messageThreadId }): Promise<void> {
          await call("sendMessage", {
            chat_id: wireChatId(chatId),
            text,
            ...(messageThreadId !== undefined ? { message_thread_id: messageThreadId } : {}),
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
        async getFileBytes({ fileId, maxBytes }): Promise<TelegramFileBytes> {
          const file = await call<TelegramFile>("getFile", { file_id: fileId });
          if (file.file_path === undefined || file.file_path === "") {
            throw new Error("getFile failed: this file cannot be downloaded");
          }
          // The declared size refuses an oversized transfer before it starts; the capped
          // read below is what actually holds, since the claim can be absent or wrong.
          if (file.file_size !== undefined && file.file_size > maxBytes) {
            throw new MessagingMediaTooLargeError("The image", maxBytes);
          }
          let res: Response;
          try {
            res = await fetch(`${TELEGRAM_API_BASE}/file/bot${creds.botToken}/${file.file_path}`, {
              signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
            });
          } catch (err) {
            throw new Error(`file download failed: ${fetchErrorText(err)}`);
          }
          // The URL carries the token, so a failure names the status and nothing else.
          if (!res.ok || res.body === null) {
            throw new Error(`file download failed: HTTP ${res.status}`);
          }
          const data = await collectUnderCap(bodyChunks(res.body), maxBytes, "The image");
          return { data, filePath: file.file_path };
        },
        async sendPhoto({ chatId, fileName, data }): Promise<void> {
          const form = new FormData();
          form.append("chat_id", String(wireChatId(chatId)));
          form.append("photo", new Blob([data]), fileName);
          await callForm("sendPhoto", form);
        },
        async sendDocument({ chatId, fileName, data }): Promise<void> {
          const form = new FormData();
          form.append("chat_id", String(wireChatId(chatId)));
          form.append("document", new Blob([data]), fileName);
          await callForm("sendDocument", form);
        },
      };
    },
  };
}
