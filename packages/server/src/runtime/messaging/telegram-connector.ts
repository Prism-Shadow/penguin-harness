/**
 * Telegram messaging connector — the second implementation of the
 * MessagingChannelConnector seam, and the proof the seam is channel-neutral. It owns
 * everything Telegram-specific: the config document's shape (a single bot token), the
 * Bot API transport behind it (injectable for tests — see telegram-api.ts), and the
 * inbound side as a `getUpdates` long-poll loop — Telegram pushes nothing without a
 * public webhook URL, so the connector pulls, which keeps local deployments working
 * exactly like the Feishu long connection does.
 *
 * The poll loop's lifecycle: a `getMe` probe (a bad token surfaces immediately as the
 * connection error instead of an eternally failing poll — it runs again ahead of every
 * recovery attempt, so a token revoked mid-outage stops reading as a stale conflict, and
 * its answer is what lets a group message's mention of THIS bot be stripped — see
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
  MessagingInboundMessage,
} from "./connector.js";
import type {
  TelegramBotClient,
  TelegramBotUser,
  TelegramCredentials,
  TelegramMessageEntity,
  TelegramTransport,
  TelegramUpdate,
} from "./telegram-api.js";

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

/** Reply refs pack the chat id in with the message id: Telegram message ids are only unique per chat. */
function replyRefOf(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

function parseReplyRef(ref: string): { chatId: string; messageId: number } {
  const i = ref.indexOf(":");
  const messageId = i >= 0 ? Number(ref.slice(i + 1)) : NaN;
  if (i <= 0 || !Number.isSafeInteger(messageId)) {
    throw new Error(`malformed telegram reply ref "${ref}"`);
  }
  return { chatId: ref.slice(0, i), messageId };
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

/** Whether this entity is a mention OF the bot itself, by either of the two shapes Telegram uses. */
function mentionsBot(text: string, entity: TelegramMessageEntity, me: TelegramBotUser): boolean {
  if (entity.type === "text_mention") return entity.user?.id === me.id;
  if (entity.type !== "mention" || me.username === undefined) return false;
  // Telegram matches @usernames case-insensitively, and a user typing the bot's handle by
  // hand rarely matches its capitalization.
  const span = text.slice(entity.offset, entity.offset + entity.length);
  return span.toLowerCase() === `@${me.username.toLowerCase()}`;
}

/** Removes one span, swallowing a single separating space so the cut leaves no gap behind. */
function cutSpan(text: string, offset: number, length: number): string {
  let end = offset + length;
  if (text[end] === " ") end += 1;
  return text.slice(0, offset) + text.slice(end);
}

/**
 * Strips the bot's own `@mention` out of a group message.
 *
 * Addressing a bot in a group means naming it, so nearly every message this connector sees
 * from a group opens with `@thisbot `. The bridge feeds inbound text to the model exactly as
 * if it had been typed into the web composer, and that prefix announces the channel the
 * message came through — a detail the model is deliberately not told. Everyone ELSE's
 * mentions stay: those are words the user chose, and they read as themselves.
 *
 * Spans are cut back to front so each remaining offset still indexes the same character
 * (removing an earlier span would shift every later one).
 */
function stripBotMention(
  text: string,
  entities: readonly TelegramMessageEntity[] | undefined,
  me: TelegramBotUser | null,
): string {
  if (entities === undefined || me === null) return text;
  const own = entities.filter((e) => mentionsBot(text, e, me)).sort((a, b) => b.offset - a.offset);
  if (own.length === 0) return text;
  let out = text;
  for (const e of own) out = cutSpan(out, e.offset, e.length);
  return out.trim();
}

/**
 * One update reduced to the bridge's normalized shape; null for updates that are not chat
 * messages. `me` is this bot's own account (null before the first `getMe` of a connection
 * has answered), used only to recognize its own mention.
 */
function normalizeUpdate(
  update: TelegramUpdate,
  me: TelegramBotUser | null,
): MessagingInboundMessage | null {
  const msg = update.message;
  if (msg === undefined) return null;
  const senderName = msg.from?.first_name ?? msg.from?.username;
  return {
    chatId: String(msg.chat.id),
    chatKind: msg.chat.type === "private" ? "direct" : "group",
    messageId: replyRefOf(msg.chat.id, msg.message_id),
    // Only text messages carry `text`; every other message type normalizes to null (the
    // bridge answers those with the text-only notice).
    text: typeof msg.text === "string" ? stripBotMention(msg.text, msg.entities, me) : null,
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
        return me.username !== undefined ? { accountLabel: `@${me.username}` } : null;
      },
      async sendText(chatId, text) {
        await bot.sendMessage({ chatId, text });
      },
      async replyText(messageRef, text) {
        const { chatId, messageId } = parseReplyRef(messageRef);
        await bot.sendMessage({ chatId, text, replyToMessageId: messageId });
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
          const msg = normalizeUpdate(update, me);
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
