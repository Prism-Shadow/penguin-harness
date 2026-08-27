/**
 * Telegram messaging connector — the second implementation of the
 * MessagingChannelConnector seam, and the proof the seam is channel-neutral. It owns
 * everything Telegram-specific: the config document's shape (a single bot token), the
 * Bot API transport behind it (injectable for tests — see telegram-api.ts), the forum-topic
 * routing it packs into the bridge's opaque chat and reply refs (see chatRefOf), and the
 * inbound side as a `getUpdates` long-poll loop — Telegram pushes nothing without a
 * public webhook URL, so the connector pulls, which keeps local deployments working
 * exactly like the Feishu long connection does.
 *
 * The poll loop's lifecycle: a `getMe` probe (a bad token surfaces immediately as the
 * connection error instead of an eternally failing poll — it runs again ahead of every
 * recovery attempt, so a token revoked mid-outage stops reading as a stale conflict, and
 * its answer is what lets a group message's opening mention of THIS bot be stripped — see
 * stripBotMention), a
 * `getWebhookInfo` probe (a webhook and `getUpdates` are mutually exclusive on the Bot API,
 * so a bot pointed at one cannot be polled until the webhook goes — the probe names it and
 * stops there, because removing it is the user's call: see below), then a one-time backlog
 * drain (`offset: -1` confirms everything sent while no connection existed
 * — a disabled binding must not replay its dark period as a task flood, matching Feishu,
 * where missed events are simply gone), then long polls advancing `offset` past each update.
 * Failures back off exponentially and report once per outage; recovery fires `onReady`
 * again, so the bridge's status tracks the outage.
 *
 * Readiness is proven by a `getUpdates`, NEVER by `getMe`. Telegram's one-poller-per-token
 * rule shows up only on `getUpdates`, as a 409 — a second server (or any other program)
 * holding the same token. `getMe` answers happily throughout, so a
 * recovery gated on `getMe` alone would clear the outage counter on every cycle: the
 * backoff would never leave its first step and every single failure would report again.
 * The recovery poll therefore runs with `timeoutSec: 0` — it must come back now, not park
 * for the long-poll window — and only its success clears `failures` and fires `onReady`.
 *
 * Nothing here writes to the bot. A registered webhook is reported, never deleted: it points
 * at whatever service the user set it on, and clearing it to make polling work here would
 * take that service off the air with no notice and no way to trace it back. So the probe
 * repeats on every recovery attempt rather than latching — the outage ends the moment the
 * user removes the webhook, and the connection then comes back on its own.
 */
import type {
  MessagingChannelConnector,
  MessagingClient,
  MessagingConnection,
  MessagingConnectorHandlers,
  MessagingInboundFile,
  MessagingInboundImage,
  MessagingInboundMessage,
  MessagingSendNote,
} from "./connector.js";
import { imageMimeOfName } from "./media.js";
import { telegramHtmlOf } from "./telegram-html.js";
import type {
  TelegramBotClient,
  TelegramBotUser,
  TelegramCredentials,
  TelegramMessage,
  TelegramMessageEntity,
  TelegramPhotoSize,
  TelegramTransport,
  TelegramUpdate,
} from "./telegram-api.js";
import { TELEGRAM_MAX_DOWNLOAD_BYTES, TelegramApiError } from "./telegram-api.js";

/** The Telegram binding's stored config document (`messaging_bindings.config_json`). */
export interface TelegramBindingConfig extends Record<string, unknown> {
  botToken: string;
}

/**
 * The token shape @BotFather issues: `<numeric bot id>:<secret>`. The id half is the
 * channel-scoped account identity (`messaging_bindings.account_id`), which is what makes
 * per-bot uniqueness robust against token rotation — a re-issued token keeps the id.
 */
const TELEGRAM_TOKEN_RE = /^(\d+):[A-Za-z0-9_-]{5,}$/;

/** The numeric bot id in front of the token's colon, or null when the token is malformed. */
export function telegramBotIdOf(botToken: string): string | null {
  const m = TELEGRAM_TOKEN_RE.exec(botToken);
  return m === null ? null : m[1]!;
}

/** Narrows a stored config document; throws a readable error on a malformed one. */
export function telegramConfigOf(config: Record<string, unknown>): TelegramBindingConfig {
  const { botToken } = config;
  if (typeof botToken !== "string" || botToken === "") {
    throw new Error("malformed telegram binding config (botToken)");
  }
  return { botToken };
}

/** Long-poll window. Telegram holds the request open up to this long when no update is pending. */
const POLL_TIMEOUT_SEC = 30;

/** Poll-failure backoff: 1s doubling to a 60s ceiling (a revoked token retries once a minute). */
function defaultRetryDelayMs(failures: number): number {
  return Math.min(1000 * 2 ** (failures - 1), 60_000);
}

export interface TelegramConnectorOpts {
  /** Test hook: backoff between failed polls (default: exponential, 1s → 60s). */
  retryDelayMs?: (failures: number) => number;
}

/**
 * Chat and reply refs pack this channel's routing context into the two opaque strings the
 * bridge already carries for it (MessagingInboundMessage's `chatId` and `messageId`): the
 * connector mints them and the connector consumes them, so nothing between the two has to
 * learn what a forum topic is — and the chat ref reaches `sendText` through the stored
 * `messaging_bindings.last_chat_id`, which is what makes the remembered topic survive a
 * restart with no column of its own.
 *
 * `:` is the separator because a Telegram chat id is a bare integer and a message id and a
 * thread id both are too, so no component can ever contain one.
 *
 * A missing trailing component means "no forum topic", which covers every chat a topic
 * cannot be sent to (see topicIdOf) as well as a forum's General topic — and it is also what
 * every chat id stored before this existed looks like, so old rows parse as themselves. That
 * is not compatibility code with a removal date: the bare form is the only encoding a chat
 * with no topic has, so nothing ever stops writing it and nothing ever stops reading it.
 */
function chatRefOf(chatId: number, threadId: number | undefined): string {
  return threadId === undefined ? `${chatId}` : `${chatId}:${threadId}`;
}

function parseChatRef(ref: string): { chatId: string; threadId?: number } {
  const i = ref.indexOf(":");
  if (i < 0) return { chatId: ref };
  const threadId = Number(ref.slice(i + 1));
  if (i === 0 || !Number.isSafeInteger(threadId)) {
    throw new Error(`malformed telegram chat ref "${ref}"`);
  }
  return { chatId: ref.slice(0, i), threadId };
}

/** Reply refs pack the chat id in with the message id: Telegram message ids are only unique per chat. */
function replyRefOf(chatId: number, messageId: number, threadId: number | undefined): string {
  const base = `${chatId}:${messageId}`;
  return threadId === undefined ? base : `${base}:${threadId}`;
}

function parseReplyRef(ref: string): { chatId: string; messageId: number; threadId?: number } {
  const [chatId, rawMessageId, rawThreadId, ...rest] = ref.split(":");
  const messageId = Number(rawMessageId);
  if (
    chatId === undefined ||
    chatId === "" ||
    rawMessageId === undefined ||
    !Number.isSafeInteger(messageId) ||
    rest.length > 0
  ) {
    throw new Error(`malformed telegram reply ref "${ref}"`);
  }
  // The thread half is optional: refs minted before it existed have two components, and so
  // does every message written outside a forum topic (see topicIdOf).
  if (rawThreadId === undefined) return { chatId, messageId };
  const threadId = Number(rawThreadId);
  if (!Number.isSafeInteger(threadId)) {
    throw new Error(`malformed telegram reply ref "${ref}"`);
  }
  return { chatId, messageId, threadId };
}

/** Abortable sleep (the backoff must not outlive a closed connection). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

/** The note `sendWithThreadFallback` resolves when the topic had to be dropped to deliver. */
const THREAD_DROPPED_NOTE = "forum topic gone, the reply went to General instead";

/**
 * One send, with the forum topic when there is one, degrading to a send without it if
 * Telegram rejects the topic.
 *
 * A topic can be deleted or closed under a conversation that was happily using it, and the
 * Bot API offers no `allow_sending_without_thread` to match the reply flag — the call simply
 * fails with `Bad Request: message thread not found`. Retrying without the topic puts the
 * message in General rather than losing a reply the model has already produced.
 *
 * Only a 400 is retried, and only when a thread was attached. Every other shape must reach
 * the caller on its first attempt: a 429 flood-wait would be made worse by an immediate
 * second request, and a transport failure — a timeout, a reset — may well have delivered the
 * message already, so re-sending it would duplicate it in the chat. Those failures surface
 * as `messaging_send_failed` instead, like any other.
 */
async function sendWithThreadFallback(
  bot: TelegramBotClient,
  args: { chatId: string; text: string; replyToMessageId?: number; parseMode?: "HTML" },
  threadId: number | undefined,
): Promise<MessagingSendNote | void> {
  if (threadId === undefined) {
    await bot.sendMessage(args);
    return;
  }
  try {
    await bot.sendMessage({ ...args, messageThreadId: threadId });
    return;
  } catch (err) {
    if (!(err instanceof TelegramApiError) || err.errorCode !== 400) throw err;
  }
  await bot.sendMessage(args);
  return THREAD_DROPPED_NOTE;
}

/**
 * One send, rendered as HTML when the binding asked for it, degrading to the plain text if
 * Telegram will not parse it.
 *
 * The formatted attempt can fail for a reason no amount of care here prevents: the tag set
 * is closed and the parser is strict, so a construct combination it dislikes answers 400
 * `Bad Request: can't parse entities`, and the whole message is refused. A reply is never
 * worth that. The plain text — what the model actually wrote, `**` and all — goes out
 * instead, and the reader loses the formatting rather than the answer.
 *
 * ANY 400 is retried, not a 400 whose description mentions entities. `description` is prose
 * Telegram rewords without notice (see telegram-api's TelegramApiError), and there is no
 * distinct code for a parse failure; a 400 from some other cause simply fails again on the
 * plain attempt and reaches the caller as it always did, one wasted request later. Every
 * other shape propagates on its first attempt for the reasons sendWithThreadFallback gives:
 * a 429 must not be answered with a second request, and a transport failure may already
 * have delivered the message.
 *
 * The order matters. The entity fallback wraps the THREAD fallback rather than the other
 * way round, so a parse failure inside a forum topic — which the inner retry cannot fix,
 * both of its attempts carrying the same bad HTML — still ends in a plain send that keeps
 * the topic.
 */
async function sendFormatted(
  bot: TelegramBotClient,
  args: { chatId: string; text: string; replyToMessageId?: number },
  threadId: number | undefined,
  markdown: boolean,
): Promise<MessagingSendNote | void> {
  if (!markdown) return sendWithThreadFallback(bot, args, threadId);
  const html = telegramHtmlOf(args.text);
  try {
    return await sendWithThreadFallback(bot, { ...args, text: html, parseMode: "HTML" }, threadId);
  } catch (err) {
    if (!(err instanceof TelegramApiError) || err.errorCode !== 400) throw err;
  }
  return sendWithThreadFallback(bot, args, threadId);
}

/** Whether this entity is a mention OF the bot itself, by either of the two shapes Telegram uses. */
function mentionsBot(text: string, entity: TelegramMessageEntity, me: TelegramBotUser): boolean {
  if (entity.type === "text_mention") return entity.user?.id === me.id;
  if (entity.type !== "mention" || me.username === undefined) return false;
  // Telegram matches @usernames case-insensitively, and a user typing the bot's handle by
  // hand rarely matches its capitalization.
  const span = text.slice(entity.offset, entity.offset + entity.length);
  return span.toLowerCase() === `@${me.username.toLowerCase()}`;
}

/**
 * Strips the bot's own `@mention` off the FRONT of a group message.
 *
 * Addressing a bot in a group means naming it, so nearly every message this connector sees
 * from a group opens with `@thisbot `. The bridge feeds inbound text to the model exactly as
 * if it had been typed into the web composer, and that prefix announces the channel the
 * message came through — a detail the model is deliberately not told.
 *
 * Only that addressing prefix goes. This bot named further in ("what is @thisbot's status?",
 * "summarize what @thisbot said yesterday") is a word the user chose exactly like everyone
 * else's mention, and cutting it would hand the model a sentence with a hole in it.
 *
 * Leading means nothing but whitespace ahead of the span, and the cut is followed by a trim,
 * which is the same whitespace policy the Feishu side applies to its own placeholder.
 */
function stripBotMention(
  text: string,
  entities: readonly TelegramMessageEntity[] | undefined,
  me: TelegramBotUser | null,
): string {
  if (entities === undefined || me === null) return text;
  const lead = entities.find(
    (e) => text.slice(0, e.offset).trim() === "" && mentionsBot(text, e, me),
  );
  if (lead === undefined) return text;
  return (text.slice(0, lead.offset) + text.slice(lead.offset + lead.length)).trim();
}

/**
 * The forum topic this message was written in, or undefined when it was written anywhere a
 * topic cannot be sent back to.
 *
 * `message_thread_id` alone does not mean "forum topic": Telegram also sets it on an
 * ordinary reply chain, in a private chat and in a supergroup that is no forum, while
 * `sendMessage`'s `message_thread_id` is accepted for forum topics only. Echoing one back
 * anywhere else fails every outbound message of that binding with `Bad Request: message
 * thread not found` — permanently, since the value is what gets persisted. Both flags are
 * therefore required before a value is minted into a ref.
 */
function topicIdOf(msg: TelegramMessage): number | undefined {
  return msg.chat.is_forum === true && msg.is_topic_message === true
    ? msg.message_thread_id
    : undefined;
}

/**
 * The variant of an inbound photo to fetch: the largest, which is the picture as sent —
 * the smaller entries are thumbnails the Bot API generated. Compared on pixel count, since
 * `width`/`height` are always present while `file_size` is optional, with the byte size as
 * the tie-break between two variants of equal dimensions.
 */
function largestPhoto(sizes: readonly TelegramPhotoSize[]): TelegramPhotoSize | null {
  let best: TelegramPhotoSize | null = null;
  for (const size of sizes) {
    if (best === null) {
      best = size;
      continue;
    }
    const pixels = size.width * size.height;
    const bestPixels = best.width * best.height;
    if (pixels > bestPixels) best = size;
    else if (pixels === bestPixels && (size.file_size ?? 0) > (best.file_size ?? 0)) best = size;
  }
  return best;
}

/**
 * The ceiling one inbound transfer actually runs under: the caller's, or Telegram's own
 * download limit where that is tighter.
 *
 * Applied here rather than left to the Bot API because of what the API does past it — a 400
 * whose only signal is prose, which would reach the chat as an unexplained download failure
 * when the truth is a size the sender can act on. For a photo the two numbers happen to be
 * equal (the server's inline-image ceiling is also 20MB); for a document the server's
 * per-file attachment cap is far larger, so this is the number that bites.
 */
function downloadCap(maxBytes: number): number {
  return Math.min(maxBytes, TELEGRAM_MAX_DOWNLOAD_BYTES);
}

/**
 * One update reduced to the bridge's normalized shape; null for updates that are not chat
 * messages. `bot` is captured by an inbound photo's or document's `fetch`, so the bytes are
 * pulled only if the bridge asks for them. `me` is this bot's own account (null before the
 * first `getMe` of a connection has answered), used only to recognize its own mention.
 */
function normalizeUpdate(
  update: TelegramUpdate,
  bot: TelegramBotClient,
  me: TelegramBotUser | null,
): MessagingInboundMessage | null {
  const msg = update.message;
  if (msg === undefined) return null;
  const senderName = msg.from?.first_name ?? msg.from?.username;
  const topicId = topicIdOf(msg);
  const photo = msg.photo !== undefined ? largestPhoto(msg.photo) : null;
  const images: MessagingInboundImage[] =
    photo === null
      ? []
      : [
          {
            fetch: async (maxBytes) => {
              const { data, filePath } = await bot.getFileBytes({
                fileId: photo.file_id,
                maxBytes: downloadCap(maxBytes),
                what: "The image",
              });
              // Telegram re-encodes what it serves as a photo, so the served path's
              // extension is the type; JPEG is what that re-encoding almost always yields.
              return { data, mimeType: imageMimeOfName(filePath) ?? "image/jpeg" };
            },
          },
        ];
  // `document` only, of the media fields an update can carry. A document is a file the
  // sender chose to send AS a file, and the only one of them that carries the sender's own
  // name; `audio`, `video`, `voice` and `video_note` are streams Telegram re-encodes for
  // playback (a `voice` is a nameless opus blob), and handing one to the Agent as an
  // `[attached file: …]` path would offer a capability that is not there — nothing
  // downstream decodes or transcribes it. What a sender actually wants delivered arrives
  // here the moment they attach it as a file, which is one menu item away; anything else
  // keeps the not-supported notice, which at least says so.
  //
  // A picture dragged in uncompressed is a `document` too, and lands as an attachment
  // rather than as an inline image: the sender asked for the original bytes to arrive, and
  // the model opens the path with `read_image` like any other file.
  const doc = msg.document ?? null;
  const files: MessagingInboundFile[] =
    doc === null
      ? []
      : [
          {
            // Absent for a client that sent none. `document` is the fallback rather than a
            // name derived from the served path, whose extension Telegram picks: a guess
            // that reads as the sender's own name is worse than an obvious placeholder.
            fileName: doc.file_name ?? "document",
            fetch: async (maxBytes) => {
              const { data } = await bot.getFileBytes({
                fileId: doc.file_id,
                maxBytes: downloadCap(maxBytes),
                what: "The file",
              });
              return data;
            },
          },
        ];
  return {
    // The topic rides the chat id so the binding remembers the LAST one written in, the same
    // way it already remembers the last chat: a user who moves to a new topic gets the
    // replies there.
    chatId: chatRefOf(msg.chat.id, topicId),
    chatKind: msg.chat.type === "private" ? "direct" : "group",
    messageId: replyRefOf(msg.chat.id, msg.message_id, topicId),
    // A text message carries `text`; a photo or a document carries its words in `caption`
    // instead, which is that message's text as far as the bridge is concerned. A caption on
    // any OTHER media kind (video, audio, voice, …) normalizes to null: those bytes are not
    // delivered, so running the model on the caption alone would answer confidently about a
    // file it never received.
    text:
      typeof msg.text === "string"
        ? stripBotMention(msg.text, msg.entities, me)
        : (photo !== null || doc !== null) && typeof msg.caption === "string"
          ? stripBotMention(msg.caption, msg.caption_entities, me)
          : null,
    ...(images.length > 0 ? { images } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(senderName !== undefined ? { senderName } : {}),
  };
}

export class TelegramConnector implements MessagingChannelConnector {
  readonly channel = "telegram" as const;
  private readonly retryDelayMs: (failures: number) => number;

  constructor(
    private readonly transport: TelegramTransport,
    opts: TelegramConnectorOpts = {},
  ) {
    this.retryDelayMs = opts.retryDelayMs ?? defaultRetryDelayMs;
  }

  private credsOf(config: Record<string, unknown>): TelegramCredentials {
    return telegramConfigOf(config);
  }

  async createClient(config: Record<string, unknown>): Promise<MessagingClient> {
    const bot = this.transport.createClient(this.credsOf(config));
    return {
      async checkCredentials() {
        const me = await bot.getMe();
        return {
          ...(me.username !== undefined ? { accountLabel: `@${me.username}` } : {}),
          // Reported only when the API actually answered the question. A missing flag is
          // "unknown", and telling a user their bot is muted in groups on the strength of an
          // absent field would send them to BotFather for nothing.
          ...(typeof me.can_read_all_group_messages === "boolean"
            ? { readsGroupMessages: me.can_read_all_group_messages }
            : {}),
        };
      },
      sendText(chatRef, text, opts) {
        const { chatId, threadId } = parseChatRef(chatRef);
        return sendFormatted(bot, { chatId, text }, threadId, opts?.markdown === true);
      },
      replyText(messageRef, text, opts) {
        const { chatId, messageId, threadId } = parseReplyRef(messageRef);
        // The thread rides along even though a reply normally inherits its target's topic:
        // `allow_sending_without_reply` degrades a vanished target to a plain send, and a
        // plain send with no thread lands in General — losing the topic exactly when the
        // conversation is least able to spare it.
        return sendFormatted(
          bot,
          { chatId, text, replyToMessageId: messageId },
          threadId,
          opts?.markdown === true,
        );
      },
      async sendImage(chatId, file) {
        await bot.sendPhoto({ chatId, fileName: file.fileName, data: file.data });
      },
      async sendFile(chatId, file) {
        await bot.sendDocument({ chatId, fileName: file.fileName, data: file.data });
      },
    };
  }

  async connect(
    config: Record<string, unknown>,
    handlers: MessagingConnectorHandlers,
  ): Promise<MessagingConnection> {
    const bot = this.transport.createClient(this.credsOf(config));
    const abort = new AbortController();
    let closed = false;
    void this.poll(bot, handlers, abort.signal, () => closed);
    return {
      close: () => {
        closed = true;
        abort.abort();
      },
    };
  }

  private async poll(
    bot: TelegramBotClient,
    handlers: MessagingConnectorHandlers,
    signal: AbortSignal,
    isClosed: () => boolean,
  ): Promise<void> {
    /** A `getUpdates` has succeeded since the last failure, and onReady fired for that up-streak. */
    let ready = false;
    /** A webhook probe has come back clean; a bot with none never has to be asked twice. */
    let webhookChecked = false;
    /** The backlog drain runs once per connection, never again after an outage: messages sent during a mere blip still deliver. */
    let drained = false;
    /** This bot's own account, from the `getMe` the loop already makes; only its own mention needs it. */
    let me: TelegramBotUser | null = null;
    let failures = 0;
    let offset: number | undefined;
    while (!isClosed()) {
      try {
        if (!ready) {
          me = await bot.getMe();
          if (isClosed()) return;
          if (!webhookChecked) {
            const { url } = await bot.getWebhookInfo();
            if (isClosed()) return;
            if (url !== "") {
              // Named, not cleared. `getUpdates` would 409 on the next line anyway, but its
              // description cannot say which webhook — and that is the whole of what the
              // user has to go and find. The flag stays unset so the next attempt re-probes.
              throw new Error(
                `a webhook is registered on this bot at ${url}, which blocks polling — remove it there and the connection recovers on its own`,
              );
            }
            webhookChecked = true;
          }
          if (!drained) {
            const backlog = await bot.getUpdates({ offset: -1, timeoutSec: 0, signal });
            if (isClosed()) return;
            const newest = backlog.at(-1);
            if (newest !== undefined) offset = newest.update_id + 1;
            drained = true;
          }
        }
        const updates = await bot.getUpdates({
          ...(offset !== undefined ? { offset } : {}),
          // Recovery polls must answer immediately — the outage is only over once a
          // `getUpdates` comes back, and parking for the long-poll window would hide that
          // for another 30s. Steady state parks as usual.
          timeoutSec: ready ? POLL_TIMEOUT_SEC : 0,
          signal,
        });
        if (isClosed()) return;
        failures = 0;
        if (!ready) {
          ready = true;
          handlers.onReady?.();
        }
        for (const update of updates) {
          offset = update.update_id + 1;
          const msg = normalizeUpdate(update, bot, me);
          if (msg !== null) await handlers.onMessage(msg);
        }
      } catch (err) {
        if (isClosed()) return;
        failures += 1;
        // One report per outage: the first failure flips the bridge to `error` and lands
        // one error record; the retries stay quiet until recovery re-fires onReady. The
        // counter survives the recovery attempt above precisely so a failure that only
        // ever hits `getUpdates` — a 409 conflict — still walks the backoff up to its
        // ceiling instead of re-polling every second forever.
        if (failures === 1) handlers.onError?.(err);
        ready = false;
        await sleep(this.retryDelayMs(failures), signal);
      }
    }
  }
}
