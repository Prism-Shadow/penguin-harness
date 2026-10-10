/**
 * WeChat messaging connector — the fourth implementation of the MessagingChannelConnector
 * seam, over the official claw bot channel. It owns everything WeChat-specific: the config
 * document a scan produces, the transport behind it (injectable for tests — see
 * wechat-api.ts), the long-poll loop that stands in for an event stream, and the ledger of
 * context tokens without which the platform refuses every send.
 *
 * ## Inbound is a poll, and there is no webhook anywhere
 *
 * The platform holds `getupdates` open until a message arrives, and the client passes back
 * the opaque cursor it was last given. Nothing in the flow wants a publicly reachable URL —
 * the property that made Telegram's `getUpdates` and QQ's gateway usable here, and QQ's
 * webhook mode not. The loop's lifecycle mirrors telegram-connector's: failures back off and
 * report once per outage, and a recovery fires `onReady` again so the bridge's status tracks
 * the outage. One dropped request is the exception: it is retried at once and opens no outage,
 * because it is the commonest failure there is and the next request usually lands.
 *
 * A window that closes with nothing to report is the ORDINARY case on a long poll, not a
 * failure — the transport resolves it as an empty answer on an unchanged cursor, and a loop
 * that treated it as an outage would flap the connection into `error` every quiet minute.
 *
 * ## Readiness is proven by the credential probe, never by a poll
 *
 * A poll is not an event that arrives: it is a request held open until one does. So a
 * connection reported ready only when a poll came back would sit at `connecting` for the
 * whole window on an idle bot — usable the entire time, and saying so nowhere, which is
 * exactly the "works but reports nothing" failure the binding panel exists to kill.
 *
 * Each cycle therefore opens with `checkCredentials`, which answers at once and proves what
 * `connected` means here: the host resolves, the transport works, and the stored token
 * authenticates. Telegram takes the opposite choice for a reason that does not apply here —
 * its one-poller-per-token conflict is visible only on `getUpdates`, so `getMe` cannot prove
 * its connection. This platform has no such rule, and a second connection on one bot is
 * already refused a binding away (409 `account_enabled_elsewhere`).
 *
 * ## The first poll is a DRAIN, and asks for a short deadline
 *
 * An empty cursor means "start from the beginning", so the first poll of a connection can
 * return everything sent while nothing was connected. Its messages are dropped and only its
 * cursor is kept — the same choice telegram-connector makes with `offset: -1`, for the same
 * reason: a binding switched on after a week dark must not replay that week as a task flood.
 * A blip is not affected, because a reconnect keeps the cursor it already had. Dropped means
 * not relayed: the context tokens they carry are still learned (see below).
 *
 * The short deadline is what keeps that from eating a live message. A drain parked for the
 * long-poll window returns not the backlog but the first thing a user sends AFTER enabling —
 * and then discards it as backlog. Asking only for what the platform is already holding makes
 * "before this connection" and "after it" the two different things they are meant to be.
 *
 * ## Direct chats only, because that is the whole channel
 *
 * This channel carries one-to-one conversations with the bot. A `group_id` exists in the
 * protocol's message shape and the platform never populates it for a bot of this kind, so
 * every inbound message is `direct` and `replyText` has nothing to thread onto — there is no
 * quote relation to honour, so it resolves to the same send `sendText` does. The bridge's
 * threading choice is invisible here rather than wrong.
 *
 * ## Media
 *
 * Text, images and files travel in BOTH directions — the widest of the four channels here,
 * where QQ refuses outbound media outright and the other two carry it at a permission's mercy.
 * Outbound media spends the same per-token budget text does (see below).
 *
 * Two inbound kinds are folded rather than carried as themselves. A VOICE message is relayed
 * as the platform's OWN transcription of it: there is no audio on this seam and nothing
 * downstream would transcribe a recording, while WeChat has already done it — so the usual
 * spoken message is answered rather than refused. A VIDEO arrives as a file. A recording the
 * platform could not transcribe reaches the bridge carrying nothing at all, which is answered
 * with its channel-neutral not-supported notice, the same way QQ's non-text messages are:
 * inventing a channel-specific refusal for it would say no more than the shared one already
 * does.
 *
 * ## The context token, the reply budget and held replies
 *
 * The platform checks a context token on EVERY send: one arrives with each inbound message and
 * must be echoed, and a send without one, with an expired one, or past about ten on one token
 * is refused with `ret: -2` "prepare failed" (see wechat-api.ts). So this file keeps a ledger
 * per (bot, user):
 *
 *   - The latest token, when it arrived and how many sends it has funded are STORED
 *     (WeChatConversationStore; `messaging_conversations` in production). A restart, a
 *     re-enable and a saved delivery preference all reconnect, and none of them may cost the
 *     conversation. The rows live as long as a binding references the bot.
 *   - The budget is QQ's passive-reply budget (see qq-connector.ts): the first
 *     `WECHAT_REPLY_BUDGET - 1` sends under a token go out at once, and later ones are combined
 *     into one send on the reserved last slot after a quiet period.
 *   - What cannot go out now — no token yet, the budget spent, a refusal — is HELD rather than
 *     dropped: stored with the token, bounded by WECHAT_HELD_MAX_CHARS, and sent under a
 *     bilingual header as soon as the user's next message brings a fresh token, ahead of that
 *     message's own answer. A send that holds throws MessagingReplyHeldError, which the bridge
 *     does not count as a failure; `onHeldChange` reports what the bot holds.
 *   - A refusal of the FIRST send under a fresh token cannot be the token's doing, so it is
 *     the content's: held text refused that way is dropped and reported, never held again.
 *   - Pictures and files are never held: they need a token and an ordinary slot, and fail like
 *     any other send without one. Neither is "send test message", which is a probe — a test
 *     that arrives an hour later proves nothing — and fails at once with
 *     MessagingNeedsRecentMessageError.
 */
import { chunkMessagingText } from "./bridge.js";
import { sniffImageMime } from "./media.js";
import type {
  MessagingChannelConnector,
  MessagingClient,
  MessagingConnection,
  MessagingConnectorHandlers,
  MessagingInboundFile,
  MessagingInboundImage,
  MessagingOutboundFile,
  MessagingSendOptions,
} from "./connector.js";
import {
  MessagingChannelError,
  MessagingNeedsRecentMessageError,
  MessagingReplyHeldError,
} from "./connector.js";
import { wechatMarkdownOf } from "./wechat-markdown.js";
import type {
  WeChatBotClient,
  WeChatCredentials,
  WeChatInboundEvent,
  WeChatTransport,
} from "./wechat-api.js";
import {
  WECHAT_API_BASE,
  WECHAT_SEND_REFUSED_CODE,
  WeChatApiError,
  createWeChatTransport,
} from "./wechat-api.js";
import { Bind, Component, Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import type { MessagingTuning } from "./bridge.js";
import type { Clock } from "../../hmr/capabilities.js";
import type { MessagingConversations } from "../../mechanisms/messaging.js";

/** The WeChat binding's stored config document (`messaging_bindings.config_json`). */
export interface WeChatBindingConfig extends Record<string, unknown> {
  /** `ilink_bot_id` — the account identity. Never secret. */
  botId: string;
  /** The bot token the scan issued. The credential. */
  botToken: string;
  /** The API host this bot was assigned (see WeChatCredentials.baseUrl). */
  baseUrl: string;
  /** `ilink_user_id` of the person who scanned; what the credential probe names. */
  userId: string;
}

/**
 * How many sends one context token funds. The platform does not publish the number; about ten
 * is what the issues filed against Tencent's own plugin report.
 */
export const WECHAT_REPLY_BUDGET = 10;

/**
 * How long the withheld tail waits for the run to say something else before it is sent — the
 * same trade QQ_TAIL_FLUSH_MS makes: short enough that a finished answer is not left hanging,
 * long enough that messages completed in quick succession share the reserved last slot.
 */
export const WECHAT_TAIL_FLUSH_MS = 1500;

/**
 * Ceiling on one conversation's held text (and on a withheld tail). A bound, not a target: when
 * it is hit the OLDEST text goes and the newest stays, because the end of an answer is its
 * conclusion; the elision marker says what happened.
 */
export const WECHAT_HELD_MAX_CHARS = 12_000;

/** Heads held replies when they are finally delivered (bilingual, like the other chat notices). */
export const WECHAT_HELD_HEADER =
  "(Replies that could not be delivered earlier 之前未能送达的回复)";

/** Marker left in place of held text dropped by the ceiling. */
const WECHAT_HELD_ELIDED = "…(earlier part omitted 前略)…";

/** What a held text send throws, by why it was held (see MessagingReplyHeldError). */
const HELD_NO_TOKEN =
  "WeChat accepts the bot's messages only after the user has messaged it: the reply is held and will be sent with their next message";
const HELD_NO_BUDGET =
  "WeChat accepts only about ten messages from the bot per message from the user: the reply is held and will be sent with their next message";

/** What a probe throws when the platform wants a recent message first. */
const NEEDS_RECENT_MESSAGE =
  "WeChat only accepts messages from the bot for a while after you message it: send the bot a message in WeChat, then try again.";

/**
 * What an outbound picture or file throws without a token or a slot. It names no file, so the
 * refusals of one reply share a reason line (see the bridge's messagingFilesNotSentRecords).
 */
const MEDIA_NO_TOKEN = "WeChat accepts files from the bot only after the user has messaged it";
const MEDIA_NO_BUDGET =
  "WeChat accepts only about ten messages from the bot per message from the user, and this conversation has used them";

/**
 * How many drains a connection asks for before it proceeds regardless.
 *
 * A drain that closed on its own deadline said nothing about where the platform stands, so
 * spending it there is what lets a whole backlog through later (see the poll loop). But an idle
 * bot's long poll may park until the deadline every time, so the retry has to be bounded: the
 * window in which an arriving message is read as backlog and dropped is already one drain long,
 * and this widens it by one more rather than leaving it open.
 */
const DRAIN_ATTEMPTS = 2;

/**
 * How long the poll loop waits after a failure, doubling to a ceiling.
 *
 * The first step is short because the common failure is a single request lost to a network
 * blip, and the ceiling is a minute because the uncommon one is a revoked token, which no
 * amount of polling fixes and which should not be asked about every second until a person
 * notices.
 */
export function wechatRetryDelayMs(failures: number): number {
  return Math.min(2_000 * 2 ** Math.max(0, failures - 1), 60_000);
}

/** Narrows a stored config document; throws a readable error on a malformed one. */
export function wechatConfigOf(config: Record<string, unknown>): WeChatBindingConfig {
  const { botId, botToken, baseUrl, userId } = config;
  if (
    typeof botId !== "string" ||
    botId === "" ||
    typeof botToken !== "string" ||
    botToken === ""
  ) {
    throw new Error("malformed wechat binding config (botId/botToken)");
  }
  return {
    botId,
    botToken,
    // A document written before the platform named a host, or by a scan whose answer carried
    // none, polls the default entry host — which is where a bot without an IDC assignment
    // lives anyway.
    baseUrl: typeof baseUrl === "string" && baseUrl !== "" ? baseUrl : WECHAT_API_BASE,
    userId: typeof userId === "string" ? userId : "",
  };
}

/** The credentials the transport takes, out of a stored document. */
function credsOf(config: Record<string, unknown>): WeChatCredentials {
  const { botId, botToken, baseUrl, userId } = wechatConfigOf(config);
  return { botId, botToken, baseUrl, userId };
}

/**
 * One inbound event as the bridge's normalized message, with media as HANDLES.
 *
 * Nothing is downloaded here on purpose (see connector.ts): a redelivery is dropped before
 * anything else happens, and a channel that downloaded first would pay a full transfer for
 * every replay.
 */
function inboundOf(
  bot: WeChatBotClient,
  evt: WeChatInboundEvent,
): {
  chatId: string;
  chatKind: "direct";
  messageId: string;
  text: string | null;
  images?: readonly MessagingInboundImage[];
  files?: readonly MessagingInboundFile[];
} {
  const images: MessagingInboundImage[] = evt.images.map((ref) => ({
    fetch: async (maxBytes: number) => {
      const data = await bot.fetchMedia(ref, maxBytes, "The image");
      // The wire names no type for an image, so the bytes are the only source — and they are
      // conclusive. PNG is the fallback for a format the sniffer does not know rather than
      // `application/octet-stream`, which no provider accepts in a data URL.
      return { data, mimeType: sniffImageMime(data) ?? "image/png" };
    },
  }));
  const files: MessagingInboundFile[] = evt.files.map((file) => ({
    fileName: file.fileName,
    fetch: (maxBytes: number) => bot.fetchMedia(file.media, maxBytes, "The file"),
  }));
  return {
    // The sender IS the chat on this channel: a bot conversation is one-to-one, and the id
    // that arrives is the one a send is addressed to.
    chatId: evt.userId,
    chatKind: "direct",
    // The reply anchor carries the chat, as it does on every channel whose message ids are
    // not globally unique — and the id must identify the MESSAGE rather than the delivery,
    // because it is also the bridge's dedupe key.
    messageId: evt.messageId === "" ? "" : `${evt.userId}:${evt.messageId}`,
    text: evt.text !== "" ? evt.text : null,
    ...(images.length > 0 ? { images } : {}),
    ...(files.length > 0 ? { files } : {}),
  };
}

/** Reads a reply anchor back to the chat it belongs to (see inboundOf). */
export function chatOfWeChatReplyRef(ref: string): string {
  const cut = ref.lastIndexOf(":");
  if (cut <= 0) throw new Error(`malformed wechat reply ref "${ref}"`);
  return ref.slice(0, cut);
}

/** Whether a send failed with the platform's catch-all refusal (see WECHAT_SEND_REFUSED_CODE). */
function isSendRefusal(err: unknown): boolean {
  return err instanceof WeChatApiError && err.ret === WECHAT_SEND_REFUSED_CODE;
}

/**
 * Drops text from the FRONT of `parts` until it fits `max`, leaving the elision marker in its
 * place. The newest part always stays, however long: it is the end of the answer.
 */
function trimFront(parts: string[], max: number): void {
  let total = parts.reduce((n, part) => n + part.length + 2, 0);
  while (total > max) {
    const elided = parts[0] === WECHAT_HELD_ELIDED;
    if (parts.length <= (elided ? 2 : 1)) return;
    const [dropped] = parts.splice(elided ? 1 : 0, 1);
    total -= (dropped?.length ?? 0) + 2;
    if (!elided) {
      parts.unshift(WECHAT_HELD_ELIDED);
      total += WECHAT_HELD_ELIDED.length + 2;
    }
  }
}

/** One conversation's stored state — `messaging_conversations.state_json` for this channel. */
export interface WeChatConversationState {
  /** The latest context token the user's messages carried; null before any arrived. */
  contextToken: string | null;
  /** When it arrived (ISO 8601). Informational: the platform does not publish the token's lifetime. */
  tokenAt: string | null;
  /** Sends already made under `contextToken` — the budget it has used. */
  spent: number;
  /** Replies waiting for the user's next message, oldest first. */
  held: string[];
  /** Since when anything is held (ISO 8601); null while `held` is empty. */
  heldSince: string | null;
}

/**
 * Where conversation state is kept, bound to this channel: the account is the bot id and the
 * chat the user id. Production wires it to `messaging_conversations`; the default is memory.
 */
export interface WeChatConversationStore {
  get(botId: string, userId: string): Record<string, unknown> | null;
  list(botId: string): { chatId: string; state: Record<string, unknown> }[];
  put(botId: string, userId: string, state: Record<string, unknown>): void;
}

/** A store in memory, copying on the way in as the database does (tests, and the default). */
export function createMemoryWeChatConversationStore(): WeChatConversationStore {
  const bots = new Map<string, Map<string, Record<string, unknown>>>();
  return {
    get: (botId, userId) => bots.get(botId)?.get(userId) ?? null,
    list: (botId) => {
      const chats = bots.get(botId);
      return chats === undefined ? [] : [...chats].map(([chatId, state]) => ({ chatId, state }));
    },
    put: (botId, userId, state) => {
      let chats = bots.get(botId);
      if (chats === undefined) {
        chats = new Map();
        bots.set(botId, chats);
      }
      chats.set(userId, JSON.parse(JSON.stringify(state)) as Record<string, unknown>);
    },
  };
}

/** Reads a stored document back, defaulting whatever is missing or malformed. */
function conversationStateOf(raw: Record<string, unknown> | null): WeChatConversationState {
  const token = raw?.contextToken;
  const tokenAt = raw?.tokenAt;
  const spent = raw?.spent;
  const heldRaw = raw?.held;
  const held = Array.isArray(heldRaw)
    ? heldRaw.filter((part): part is string => typeof part === "string" && part !== "")
    : [];
  const heldSince = raw?.heldSince;
  return {
    contextToken: typeof token === "string" && token !== "" ? token : null,
    tokenAt: typeof tokenAt === "string" ? tokenAt : null,
    spent: typeof spent === "number" && Number.isFinite(spent) && spent > 0 ? Math.floor(spent) : 0,
    held,
    heldSince: held.length > 0 && typeof heldSince === "string" ? heldSince : null,
  };
}

/**
 * One conversation's ledger: the stored state, plus what lives only in this process — the tail
 * withheld for the reserved slot, its quiet timer, the send chain and the client to send with.
 */
interface WeChatConversation extends WeChatConversationState {
  botId: string;
  userId: string;
  /** Text withheld for the reserved last slot (see flushTail). */
  tail: string[];
  timer: ReturnType<typeof setTimeout> | null;
  /**
   * Sends are serialised per conversation, and every DECISION is made on the chain too: the
   * budget is read when a send's turn comes, not when it was asked for, so a held-reply flush
   * already in flight is counted before the run's next message chooses between a slot and the
   * tail.
   */
  chain: Promise<void>;
  /**
   * The client the last send or inbound message used, which is the one a deferred flush uses —
   * a flush can be started by an inbound message or a timer, neither of which has an outbound
   * client of its own. Null until either has happened, and nothing can be held or withheld
   * before then without one being set.
   */
  bot: WeChatBotClient | null;
  /**
   * The token came with a LIVE message, not with the backlog a drain read. Only such a token
   * is known to be fresh, so only its first refusal can be blamed on the content rather than
   * on the token (see flushHeld): a backlog message may be days old, and its token with it.
   */
  tokenLive: boolean;
}

export interface WeChatConnectorOpts {
  /** Test hook: the poll loop's backoff (tests collapse it to zero). */
  retryDelayMs?: (failures: number) => number;
  /** Where conversation state is stored (default: memory, which a restart loses). */
  store?: WeChatConversationStore;
  /** Test hook: how long the tail waits for more output before it is sent (default WECHAT_TAIL_FLUSH_MS). */
  tailFlushMs?: number;
  now?: () => number;
}

export class WeChatConnector implements MessagingChannelConnector {
  readonly channel = "wechat" as const;
  /** The bridge caps the one-message-per-line split at this rather than at its own 20. */
  readonly replyBudget = WECHAT_REPLY_BUDGET;

  /**
   * Conversation ledgers per `(botId, userId)`. On the connector rather than on a client,
   * because the two halves that need them arrive separately: tokens come in through `connect`,
   * and sends go out through the client `createClient` hands the bridge. The bot is part of the
   * key so two bindings on different bots can never spend each other's conversation handles.
   */
  private readonly conversations = new Map<string, WeChatConversation>();
  /**
   * The open connection's handlers per bot. The client half reports through them too — a held
   * reply or a failed flush belongs to the binding's status whichever half caused it — and a
   * client has no connection of its own to report through.
   */
  private readonly handlers = new Map<string, MessagingConnectorHandlers>();
  /** The `onHeldChange` value last reported per bot, so only changes are reported. */
  private readonly heldReported = new Map<string, string>();
  private readonly store: WeChatConversationStore;
  private readonly retryDelayMs: (failures: number) => number;
  private readonly tailFlushMs: number;
  private readonly now: () => number;

  constructor(
    private readonly transport: WeChatTransport,
    opts: WeChatConnectorOpts = {},
  ) {
    this.retryDelayMs = opts.retryDelayMs ?? wechatRetryDelayMs;
    this.store = opts.store ?? createMemoryWeChatConversationStore();
    this.tailFlushMs = opts.tailFlushMs ?? WECHAT_TAIL_FLUSH_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  async createClient(config: Record<string, unknown>): Promise<MessagingClient> {
    const creds = credsOf(config);
    const bot = this.transport.createClient(creds);
    const text = async (
      userId: string,
      body: string,
      opts: MessagingSendOptions | undefined,
    ): Promise<void> => {
      const rendered = opts?.markdown === true ? wechatMarkdownOf(body) : body;
      await this.enqueue(creds.botId, bot, userId, (c) =>
        opts?.probe === true ? this.deliverProbe(c, rendered) : this.deliverText(c, rendered),
      );
    };
    return {
      async checkCredentials(): Promise<null> {
        await bot.checkCredentials();
        // `getconfig` answers with a typing ticket and nothing that names the bot or the
        // account, so there is no label to surface — the same shape as QQ's probe.
        return null;
      },
      sendText: (chatId: string, body: string, opts?: MessagingSendOptions) =>
        text(chatId, body, opts),
      // The same operation as sendText: this channel has no quote relation to thread onto
      // (see the module doc), so the anchor is read only for the chat it names.
      replyText: async (ref: string, body: string, opts?: MessagingSendOptions) =>
        text(chatOfWeChatReplyRef(ref), body, opts),
      sendImage: (chatId: string, file: MessagingOutboundFile) =>
        this.enqueue(creds.botId, bot, chatId, (c) => this.deliverMedia(c, "image", file)),
      sendFile: (chatId: string, file: MessagingOutboundFile) =>
        this.enqueue(creds.botId, bot, chatId, (c) => this.deliverMedia(c, "file", file)),
    };
  }

  async connect(
    config: Record<string, unknown>,
    handlers: MessagingConnectorHandlers,
  ): Promise<MessagingConnection> {
    const creds = credsOf(config);
    const botId = creds.botId;
    const bot = this.transport.createClient(creds);
    this.handlers.set(botId, handlers);
    this.heldReported.delete(botId);
    this.hydrate(botId);
    // A backlog held before a restart or a disable is this connection's to report.
    this.reportHeld(botId);
    const abort = new AbortController();
    let closed = false;
    void this.poll(creds, bot, handlers, abort.signal, () => closed);
    return {
      close: () => {
        closed = true;
        abort.abort();
        // Only the bot's CURRENT connection lets go of it: a stale attempt the bridge closes
        // after a newer one opened must not take the newer one's handlers or tails with it.
        if (this.handlers.get(botId) !== handlers) return;
        this.handlers.delete(botId);
        this.heldReported.delete(botId);
        // Tokens are deliberately NOT dropped: they live as long as a binding references the
        // bot (see MessagingBindingsRepo), because every reconnect dropping them is what left
        // replies refused. A withheld tail has no connection left to time it, so it is held.
        this.parkTails(botId);
      },
    };
  }

  // —— The conversation ledger ——————————————————————————————————————————————

  private key(botId: string, userId: string): string {
    return `${botId}\n${userId}`;
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  private load(
    botId: string,
    userId: string,
    raw: Record<string, unknown> | null,
  ): WeChatConversation {
    const state = conversationStateOf(raw);
    return {
      ...state,
      // A document from before `heldSince` was written, or one that lost it, still says
      // something is held; when it started is then unknown, and now is the honest bound.
      heldSince: state.held.length > 0 ? (state.heldSince ?? this.nowIso()) : null,
      botId,
      userId,
      tail: [],
      timer: null,
      chain: Promise.resolve(),
      bot: null,
      // A stored token's freshness is unknown after a load (see tokenLive).
      tokenLive: false,
    };
  }

  /** Get-or-load one conversation; a store that cannot be read reads as a conversation never seen. */
  private conversationFor(botId: string, userId: string): WeChatConversation {
    const key = this.key(botId, userId);
    let c = this.conversations.get(key);
    if (c === undefined) {
      let raw: Record<string, unknown> | null = null;
      try {
        raw = this.store.get(botId, userId);
      } catch {
        // The user's next message rebuilds the token; nothing more is lost than a restart costs.
      }
      c = this.load(botId, userId, raw);
      this.conversations.set(key, c);
    }
    return c;
  }

  /**
   * Brings the bot's ledgers in line with the store at connect: every stored conversation is
   * loaded, so its token is ready and its held backlog reported; and a ledger the store no
   * longer has is forgotten, because its rows were deleted with the bot's last binding — a
   * token or a held reply must not carry over onto a binding scanned afresh.
   */
  private hydrate(botId: string): void {
    let stored: { chatId: string; state: Record<string, unknown> }[];
    try {
      stored = this.store.list(botId);
    } catch {
      return;
    }
    const ids = new Set(stored.map((s) => s.chatId));
    for (const [key, c] of this.conversations) {
      if (c.botId !== botId || ids.has(c.userId)) continue;
      if (c.timer !== null) clearTimeout(c.timer);
      this.conversations.delete(key);
    }
    for (const { chatId, state } of stored) {
      const key = this.key(botId, chatId);
      if (this.conversations.has(key)) continue;
      this.conversations.set(key, this.load(botId, chatId, state));
    }
  }

  /**
   * Writes one conversation's stored half. Best effort: the in-memory ledger stays right for
   * this process either way, and a failed write costs only what a restart would — the next
   * inbound message's token. A send that already went out must not be reported as failed
   * because its bookkeeping could not be written.
   */
  private persist(c: WeChatConversation): void {
    const state = {
      contextToken: c.contextToken,
      tokenAt: c.tokenAt,
      spent: c.spent,
      held: c.held,
      heldSince: c.heldSince,
    } satisfies WeChatConversationState;
    try {
      this.store.put(c.botId, c.userId, state);
    } catch {
      // See above.
    }
  }

  /** Since when the bot has held anything: the oldest of its conversations' `heldSince`. */
  private heldSinceOf(botId: string): string | null {
    let since: string | null = null;
    for (const c of this.conversations.values()) {
      if (c.botId !== botId || c.held.length === 0 || c.heldSince === null) continue;
      if (since === null || c.heldSince < since) since = c.heldSince;
    }
    return since;
  }

  private reportHeld(botId: string): void {
    const since = this.heldSinceOf(botId);
    if ((this.heldReported.get(botId) ?? null) === since) return;
    if (since === null) this.heldReported.delete(botId);
    else this.heldReported.set(botId, since);
    this.handlers.get(botId)?.onHeldChange?.(since);
  }

  private reportSendFailed(botId: string, err: unknown): void {
    this.handlers.get(botId)?.onSendFailed?.(err);
  }

  /** Appends to the held text, trimming from the front, and stores it. */
  private hold(c: WeChatConversation, texts: readonly string[]): void {
    if (texts.length === 0) return;
    c.held.push(...texts);
    trimFront(c.held, WECHAT_HELD_MAX_CHARS);
    c.heldSince ??= this.nowIso();
    this.persist(c);
    this.reportHeld(c.botId);
  }

  /** Replaces the held text with what is still undelivered, and stores it. */
  private setHeld(c: WeChatConversation, held: string[]): void {
    c.held = held;
    if (held.length === 0) c.heldSince = null;
    this.persist(c);
    this.reportHeld(c.botId);
  }

  /** The token has funded everything it will: a refusal says so whatever the local count was. */
  private exhaust(c: WeChatConversation): void {
    c.spent = Math.max(c.spent, WECHAT_REPLY_BUDGET);
    this.persist(c);
  }

  /** Every withheld tail of one bot, moved into its held text — the connection's close. */
  private parkTails(botId: string): void {
    for (const c of this.conversations.values()) {
      if (c.botId !== botId) continue;
      if (c.timer !== null) {
        clearTimeout(c.timer);
        c.timer = null;
      }
      if (c.tail.length === 0) continue;
      const tail = c.tail;
      c.tail = [];
      this.hold(c, tail);
    }
  }

  /**
   * An inbound message (drained or live): learns its token, and when that is a NEW one —
   * fresh budget — delivers what was held, before the bridge hears of the message, so the
   * user reads what they missed ahead of the answer to what they just said. Never rejects:
   * what fails here is reported, and must not read as a poll failure.
   */
  private async noteInbound(
    botId: string,
    bot: WeChatBotClient,
    evt: WeChatInboundEvent,
    live: boolean,
  ) {
    const token = evt.contextToken;
    if (token === undefined) return;
    const c = this.conversationFor(botId, evt.userId);
    c.bot = bot;
    // The same token again is a redelivery, not fresh budget: resetting the count on it would
    // send past what the token funds and have the rest of the answer refused.
    if (c.contextToken === token) return;
    c.contextToken = token;
    c.tokenAt = this.nowIso();
    c.spent = 0;
    c.tokenLive = live;
    this.persist(c);
    // A tail still waiting for its quiet period was written before this message; it goes out
    // with the held text, ahead of the answer this message will get.
    if (c.timer !== null) {
      clearTimeout(c.timer);
      c.timer = null;
    }
    if (c.tail.length > 0) {
      c.held.push(...c.tail);
      c.tail = [];
      trimFront(c.held, WECHAT_HELD_MAX_CHARS);
      c.heldSince ??= this.nowIso();
    }
    if (c.held.length === 0) return;
    await this.chain(c, () => this.flushHeld(c)).catch(() => {});
  }

  /**
   * Sends the held text under the bilingual header, in channel-sized chunks, while ordinary
   * slots last — the reserved last one stays for the answer this message will get. What does
   * not fit stays held for the message after.
   *
   * A refusal of the very first send under a token a LIVE message just brought is about the
   * CONTENT — the token is fresh and has funded nothing yet — so the held text is dropped
   * rather than held to be refused again, and reported. A backlog token proves no freshness
   * (see tokenLive), and any later refusal is the token's: both keep the rest held. A network
   * failure keeps it too, and is reported.
   */
  private async flushHeld(c: WeChatConversation): Promise<void> {
    if (c.held.length === 0 || c.contextToken === null || c.bot === null) return;
    const chunks = chunkMessagingText([WECHAT_HELD_HEADER, ...c.held].join("\n\n"));
    const fresh = c.spent === 0 && c.tokenLive;
    let sent = 0;
    try {
      while (sent < chunks.length && c.spent < WECHAT_REPLY_BUDGET - 1) {
        await this.sendNow(c, chunks[sent]!);
        sent += 1;
      }
    } catch (err) {
      if (isSendRefusal(err) && fresh && sent === 0) {
        this.setHeld(c, []);
        // Not `recovers`: the same text would be refused the same way, and it is gone.
        const reason = err instanceof Error ? err.message : String(err);
        this.reportSendFailed(
          c.botId,
          new MessagingChannelError(
            `WeChat refused the held replies under a fresh conversation token, so they were dropped: ${reason}`,
            false,
          ),
        );
        return;
      }
      if (isSendRefusal(err)) this.exhaust(c);
      else this.reportSendFailed(c.botId, err);
    }
    // Nothing sent keeps the held text exactly as it was, so the header is never doubled.
    this.setHeld(c, sent === 0 ? c.held : chunks.slice(sent));
  }

  /** One real text send under the conversation's token, counted before the wire. */
  private async sendNow(c: WeChatConversation, text: string): Promise<void> {
    const bot = c.bot;
    const contextToken = c.contextToken;
    if (bot === null || contextToken === null) throw new MessagingReplyHeldError(HELD_NO_TOKEN);
    // Reserved before the await: whether a send that failed on the way counted against the
    // token is unknown, and over-counting costs a reply's place in the tail, never the reply.
    c.spent += 1;
    this.persist(c);
    await bot.sendText({ userId: c.userId, text, contextToken });
  }

  /** Get-or-load the conversation and queue `run` on its chain. */
  private enqueue(
    botId: string,
    bot: WeChatBotClient,
    userId: string,
    run: (c: WeChatConversation) => Promise<void>,
  ): Promise<void> {
    const c = this.conversationFor(botId, userId);
    c.bot = bot;
    return this.chain(c, () => run(c));
  }

  /**
   * One outbound text: sent while an ordinary slot is free, withheld for the reserved last slot
   * once only that is left, and held — with MessagingReplyHeldError — when nothing can carry it
   * now.
   */
  private async deliverText(c: WeChatConversation, text: string): Promise<void> {
    if (c.contextToken === null) {
      this.hold(c, [text]);
      throw new MessagingReplyHeldError(HELD_NO_TOKEN);
    }
    if (c.spent < WECHAT_REPLY_BUDGET - 1) {
      try {
        await this.sendNow(c, text);
      } catch (err) {
        if (!isSendRefusal(err)) throw err;
        // Expired, or spent on sends this ledger did not count: either way this token is done.
        this.exhaust(c);
        this.hold(c, [text]);
        throw new MessagingReplyHeldError(HELD_NO_BUDGET);
      }
      return;
    }
    if (c.spent < WECHAT_REPLY_BUDGET) {
      c.tail.push(text);
      trimFront(c.tail, WECHAT_HELD_MAX_CHARS);
      this.scheduleTailFlush(c);
      return;
    }
    this.hold(c, [text]);
    throw new MessagingReplyHeldError(HELD_NO_BUDGET);
  }

  private scheduleTailFlush(c: WeChatConversation): void {
    if (c.timer !== null) clearTimeout(c.timer);
    c.timer = setTimeout(() => {
      c.timer = null;
      void this.chain(c, () => this.flushTail(c)).catch(() => {});
    }, this.tailFlushMs);
    // A pending flush must never be the reason the process cannot exit.
    c.timer.unref?.();
  }

  /**
   * Spends the reserved last slot on everything withheld, as one message. A combined tail over
   * the channel's size cap sends its FIRST chunk and holds the rest; a refusal holds all of it.
   */
  private async flushTail(c: WeChatConversation): Promise<void> {
    if (c.tail.length === 0) return;
    const tail = c.tail;
    c.tail = [];
    if (c.contextToken === null || c.bot === null || c.spent >= WECHAT_REPLY_BUDGET) {
      this.hold(c, tail);
      return;
    }
    const [head, ...rest] = chunkMessagingText(tail.join("\n\n"));
    if (head === undefined) return;
    try {
      await this.sendNow(c, head);
    } catch (err) {
      if (isSendRefusal(err)) {
        this.exhaust(c);
        this.hold(c, [head, ...rest]);
        return;
      }
      this.hold(c, rest);
      this.reportSendFailed(c.botId, err);
      return;
    }
    this.hold(c, rest);
  }

  /** "Send test message": sent now or refused now, never held or withheld (see the module doc). */
  private async deliverProbe(c: WeChatConversation, text: string): Promise<void> {
    if (c.contextToken === null || c.spent >= WECHAT_REPLY_BUDGET) {
      throw new MessagingNeedsRecentMessageError(NEEDS_RECENT_MESSAGE);
    }
    try {
      await this.sendNow(c, text);
    } catch (err) {
      if (!isSendRefusal(err)) throw err;
      this.exhaust(c);
      throw new MessagingNeedsRecentMessageError(NEEDS_RECENT_MESSAGE);
    }
  }

  /**
   * One outbound picture or file. It takes an ordinary slot, never the reserved one, and is
   * never held: bytes are not what the conversation store is for, and the reply's text — which
   * names the file — already went out or is held itself.
   */
  private async deliverMedia(
    c: WeChatConversation,
    kind: "image" | "file",
    file: MessagingOutboundFile,
  ): Promise<void> {
    const bot = c.bot;
    const contextToken = c.contextToken;
    if (bot === null || contextToken === null) {
      throw new MessagingChannelError(MEDIA_NO_TOKEN, true);
    }
    if (c.spent >= WECHAT_REPLY_BUDGET - 1) throw new MessagingChannelError(MEDIA_NO_BUDGET, true);
    // One slot: the transport sends a caption as a message of its own only when there is one,
    // and these sends carry none (below).
    c.spent += 1;
    this.persist(c);
    // The caption is empty because the bridge sends a reply's text as its own message: a
    // picture here is the picture, and pairing it would duplicate what already went.
    const args = { userId: c.userId, text: "", contextToken, file };
    try {
      if (kind === "image") await bot.sendImage(args);
      else await bot.sendFile(args);
    } catch (err) {
      if (!isSendRefusal(err)) throw err;
      this.exhaust(c);
      throw new MessagingChannelError(MEDIA_NO_BUDGET, true);
    }
  }

  /**
   * Appends to the conversation's chain. The chain never rejects — the caller's promise carries
   * the failure, and one failed send must not poison the conversation's later ones.
   */
  private chain(c: WeChatConversation, run: () => Promise<void>): Promise<void> {
    const result = c.chain.then(run);
    c.chain = result.catch(() => {});
    return result;
  }

  // —— The long poll ————————————————————————————————————————————————————————

  private async poll(
    creds: WeChatCredentials,
    bot: WeChatBotClient,
    handlers: MessagingConnectorHandlers,
    signal: AbortSignal,
    isClosed: () => boolean,
  ): Promise<void> {
    /** The credential probe has answered since the last failure, and onReady fired for it. */
    let ready = false;
    /** The backlog drain runs once per connection, never again after an outage (see the module doc). */
    let drained = false;
    /** Drains that closed on their deadline without the platform answering. */
    let drainAttempts = 0;
    let failures = 0;
    /** A dropped request was just retried at once; the next failure before a poll comes back is an outage. */
    let blipRetried = false;
    /** What this outage has already reported (see qq-api's GatewaySession.reported). */
    let reported: "none" | "routine" | "defect" = "none";
    let cursor = "";
    while (!isClosed()) {
      try {
        if (!ready) {
          // Readiness is proven HERE and not by a poll, because a poll is not an event: a
          // long poll with nothing to report holds its request open for the whole window, so
          // a connection reported ready only once one came back would sit at `connecting` for
          // half a minute on an idle bot while being perfectly usable. This call answers at
          // once and proves what "connected" means on this channel — the host resolves, the
          // transport works, and the stored token authenticates.
          //
          // It runs again ahead of every recovery attempt, like telegram-connector's, so a
          // token revoked during an outage stops the loop with the right reason rather than
          // as an endless poll failure.
          await bot.checkCredentials();
          if (isClosed()) return;
          ready = true;
          handlers.onReady?.();
        }
        // The first call of a connection is a DRAIN, and asks for a short deadline: it wants
        // whatever the platform is already holding, not whatever arrives next. Parked for the
        // long-poll window it would instead return the first message a user sends after
        // enabling — and then drop it as backlog.
        const {
          messages,
          cursor: next,
          timedOut,
        } = await bot.getUpdates({
          cursor,
          signal,
          ...(drained ? {} : { drain: true }),
        });
        if (isClosed()) return;
        cursor = next;
        blipRetried = false;
        if (!drained) {
          // The cursor above is kept; these messages are not relayed. Everything from before
          // the connection existed is confirmed rather than relayed — but its tokens are the
          // newest the user has given, so they are learned, and what was held goes out on them.
          for (const evt of messages) {
            if (isClosed()) return;
            await this.noteInbound(creds.botId, bot, evt, false);
          }
          // A drain that hit its short deadline said nothing about where the platform stands,
          // and its cursor is the one it was given — so spending it there would leave the
          // cursor at the beginning and let the next ordinary poll relay a whole backlog as
          // live traffic, which is the flood this exists to prevent. Retried instead, a few
          // times: a bounded retry, because an idle bot whose long poll simply parks would
          // otherwise ask forever, and after the bound the old behaviour is the safer of the
          // two remaining wrongs — replaying a backlog beats discarding the first message a
          // user sends after enabling.
          if (!timedOut || ++drainAttempts >= DRAIN_ATTEMPTS) drained = true;
          continue;
        }
        // Cleared here rather than beside the probe: the probe and the poll are different
        // endpoints, so a failure that only ever hits the poll would otherwise be zeroed by
        // every recovery, never walk the backoff up, and write one error record per attempt.
        failures = 0;
        reported = "none";
        for (const evt of messages) {
          if (isClosed()) return;
          // The token is learned BEFORE the bridge is told, so the reply to this very message
          // is already addressed to the right conversation — and what was held is delivered
          // before that reply is even written.
          await this.noteInbound(creds.botId, bot, evt, true);
          await handlers.onMessage(inboundOf(bot, evt));
        }
      } catch (err) {
        if (isClosed()) return;
        // One dropped request is retried at once, as if it had not happened: no outage, no
        // report, no backoff. It is the commonest failure there is and the next request usually
        // lands, while an outage costs the panel an `error` flash and the table a record. A
        // second one before a poll comes back is no longer a blip, and takes the path below.
        if (!blipRetried && err instanceof WeChatApiError && err.network) {
          blipRetried = true;
          continue;
        }
        ready = false;
        failures += 1;
        // Reported once per outage, not once per attempt: a token revoked overnight would
        // otherwise write one error record per retry until somebody looked. A failure that
        // recovers on its own is filed `expected`, so it does not get to be the whole story:
        // the first one after it that does not recover is reported too.
        const routine = err instanceof MessagingChannelError && err.recovers;
        if (reported === "none" || (reported === "routine" && !routine)) {
          reported = routine ? "routine" : "defect";
          handlers.onError?.(err);
        }
        await this.sleep(this.retryDelayMs(failures), signal);
      }
    }
  }

  /** A backoff that a close ends immediately rather than after its full delay. */
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0 || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/** The wechat connector, contributed to messaging.connectors like any third-party one would be. */
@Component({
  contributes: {
    "MessagingModule.connectors": [
      {
        id: "messaging-wechat.connector",
        channel: "wechat",
      },
    ],
  },
})
export class WechatMessaging {
  @Use() private readonly wechat!: WeChatTransportHandle;
  @Use() private readonly tuning!: MessagingTuning;
  @Use() private readonly clock!: Clock;
  @Use() private readonly conversations!: MessagingConversations;
  @Bind("messaging-wechat.connector") connector!: MessagingChannelConnector;
  setup() {
    const { retryDelayMs } = this.tuning;
    const conversations = this.conversations;
    this.connector = new WeChatConnector(this.wechat.transport, {
      ...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
      store: {
        get: (botId, userId) => conversations.get("wechat", botId, userId),
        list: (botId) => conversations.list("wechat", botId),
        put: (botId, userId, state) => conversations.put("wechat", botId, userId, state),
      },
      now: () => this.clock.now().getTime(),
    });
  }
}

/** The long-poll + CDN transport as a node, so a test stands in a fake for the network. */
@Interface()
export abstract class WeChatTransportHandle {
  abstract transport: Opaque<"WeChatTransport", WeChatTransport>;
}
@Module()
export class WeChatTransportProvider {
  @Provide() wechatTransport!: WeChatTransportHandle;
  setup() {
    this.wechatTransport = { transport: createWeChatTransport() };
  }
}
