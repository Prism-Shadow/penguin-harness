/**
 * QQ messaging connector — the third implementation of the MessagingChannelConnector seam,
 * and the first one whose platform will not let a bot speak freely. It owns everything
 * QQ-specific: the config document's shape (App ID + App Secret), the transport behind it
 * (injectable for tests — see qq-api.ts), the reduction of the two subscribed gateway
 * events to the bridge's normalized inbound shape, and — the part with no counterpart on
 * the other two channels — the PASSIVE REPLY BUDGET.
 *
 * ## Why this file has a budget in it
 *
 * QQ has two ways to send a message and this product can only use one of them. A PASSIVE
 * REPLY carries the `msg_id` of an inbound message, and the platform allows a small,
 * fixed number of them per inbound message inside a short window (see
 * QQ_REPLY_BUDGET / QQ_PASSIVE_WINDOW_MS). An ACTIVE message carries no `msg_id`, is rate
 * limited per bot and per relationship, is capped at a thousand a day, and fails outright
 * for any user who has turned bot pushes off in their QQ client — a switch this product
 * cannot see, ask about, or work around. So every send here is a passive reply, and the
 * budget is not an optimization: past it the platform answers 40034128 and the message is
 * simply gone.
 *
 * The bridge's outbound model does not fit that shape on its own. It relays EVERY
 * completed assistant message of a run as its own chat message, and one run routinely
 * completes more of them than QQ will accept. So this connector reconciles the two:
 *
 *   - The first `budget - 1` messages of an inbound message's answer go out immediately,
 *     one per completed assistant message, exactly as on Feishu and Telegram. The chat
 *     follows the run as it happens for as long as the budget can afford to.
 *   - Everything after that accumulates in a tail buffer, which is sent as ONE combined
 *     message using the reserved final slot. Dropping the end of a reply is the worst
 *     failure available here, so nothing is ever dropped — it is combined.
 *   - The tail is flushed after a short quiet period (QQ_TAIL_FLUSH_MS). This connector
 *     cannot see run boundaries — the seam deliberately does not show it any — and quiet
 *     is the honest local proxy for "the answer is finished". The delay applies only to
 *     runs that overflowed the budget in the first place.
 *   - The approval notice competes for the same budget, and it must not lose: a run
 *     blocked on approval will not produce another message until a human acts, so a notice
 *     that waited for the run to finish would wait forever. It is therefore an ordinary
 *     send — it takes an immediate slot when one is free, and otherwise joins the tail,
 *     whose quiet timer fires a second later precisely because the run has gone quiet
 *     waiting for the approval. Either way it arrives.
 *   - Once the final slot is spent, further messages keep accumulating and are flushed by
 *     the next inbound message, whose `msg_id` carries a fresh budget — that is the only new
 *     budget that ever exists — provided the message they were written for has not itself
 *     expired in the meantime (see noteInbound).
 *   - A chat's accounting lives no longer than the connection that opened it. Closing the
 *     gateway — the unbind, or the restart a credential change makes — forgets that
 *     account's ledgers, so nothing withheld can arrive in a chat the binding has stopped
 *     answering; and a chat left quiet past the window is swept when the map next grows.
 *
 * ## Why an undeliverable reply throws instead of vanishing
 *
 * With no fundable slot — no inbound message yet, the window closed, or the budget spent
 * with the tail already flushed — a send THROWS rather than silently returning. QQ offers
 * no push this product may use, so the honest report is that the reply did not arrive, and
 * the bridge turns that into one error record (the error recorder collapses a storm of the
 * same code into one row per window, so a conversation driven from the web UI does not
 * flood it). Silence would be worse in both directions: the "send test message" button
 * would claim a delivery that never happened, and a user watching QQ for an answer would
 * have nothing to explain its absence.
 *
 * ## Why `replyText` and `sendText` do the same thing here
 *
 * On Feishu and Telegram a reply-to is a visible relation — the chat renders a quote header
 * — which is why the bridge threads a run's first message onto the inbound one and sends
 * the rest plainly. On QQ `msg_id` is an authorization anchor, not a quote: a passive reply
 * renders exactly like any other message. So both seam methods resolve to the same
 * operation, and the bridge's threading choice is invisible here rather than wrong.
 *
 * ## Media
 *
 * Both directions carry it, through the platform's own rich-media API rather than anything
 * this server has to host.
 *
 * INBOUND: a message's `attachments` become the bridge's image and file handles — fetched
 * lazily, under the bridge's caps, from the platform's signed download links. A voice
 * recording is read as the platform's own transcript (`asr_refer_text`), the way WeChat's is:
 * nothing downstream decodes audio, and one with no transcript reads as no text at all, which
 * the bridge answers with its not-supported notice. A quoted message's text rides above the
 * reply as a blockquote.
 *
 * OUTBOUND: the bytes are registered (qq-upload.ts, which costs no slot) and then sent as a
 * `msg_type: 7` passive reply, which costs ONE slot from the same ledger the text draws on.
 * A file may take any slot while nothing is withheld for the final one; once text is waiting
 * there, the file does not get to push it out to a later message. A file that cannot be sent
 * for want of a slot, or that the platform refuses, is never dropped silently: a one-line
 * note joins the tail (so the chat hears about it as soon as a slot exists), and the failure
 * is also thrown so the bridge files its error record — see sendMedia.
 */
import { MESSAGING_TEXT_CHUNK_CHARS, chunkMessagingText } from "./bridge.js";
import type { MessagingTuning } from "./bridge.js";
import { MessagingMediaTooLargeError, MessagingUnsupportedError, sniffImageMime } from "./media.js";
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
import { chunkMarkdown } from "./markdown.js";
import type {
  QQAttachment,
  QQBotClient,
  QQChatKind,
  QQCredentials,
  QQInboundEvent,
  QQTransport,
} from "./qq-api.js";
import type { QQFileType } from "./qq-upload.js";
import { QQ_BODY_INDEPENDENT_SEND_CODES, QQApiError, createQQTransport } from "./qq-api.js";
import { qqMarkdownOf } from "./qq-markdown.js";
import { Bind, Component, Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Opaque } from "@prismshadow/penguin-core/kernel";
import type { MessagingClock } from "./ports.js";

/** The QQ binding's stored config document (`messaging_bindings.config_json`). */
export interface QQBindingConfig extends Record<string, unknown> {
  appId: string;
  appSecret: string;
}

/**
 * How many passive replies one inbound message funds, per chat scene. These are the
 * platform's numbers and they are NOT the same on both sides: a single chat allows 4, a
 * group 5.
 */
export const QQ_REPLY_BUDGET: Record<QQChatKind, number> = { c2c: 4, group: 5 };

/**
 * The tighter of the two budgets, which is what channel-neutral callers clamp to. Using the
 * smaller number everywhere keeps a binding's delivery behaviour the same whether the bot
 * was messaged in a single chat or a group — a setting that changed meaning depending on
 * where the last message came from would be indefensible.
 */
export const QQ_MIN_REPLY_BUDGET = Math.min(...Object.values(QQ_REPLY_BUDGET));

/**
 * How long an inbound message stays repliable.
 *
 * The platform's own documentation contradicts itself here: the single-chat overview says
 * 60 minutes while the `msg_id` parameter table on the same page says 5, and the group
 * pages say 5 in both places. 5 minutes is the number every normative table agrees on, so
 * it is the one this product designs against — treating the window as short can only cost
 * a reply that would have been delivered, while treating it as long costs replies that are
 * silently rejected.
 */
export const QQ_PASSIVE_WINDOW_MS = 5 * 60_000;

/**
 * How long the tail waits for the run to say something else before it is sent.
 *
 * Short enough that a finished answer is not left hanging, long enough that a run
 * completing several messages in quick succession combines them into one send instead of
 * spending the final slot on the first of them.
 */
export const QQ_TAIL_FLUSH_MS = 1500;

/**
 * Ceiling on the withheld tail's size. It exists only as a bound — one run's output is
 * finite — and when it is hit the OLDEST buffered text is dropped, never the newest: the
 * end of an answer is its conclusion, and the elision marker says what happened.
 */
export const QQ_TAIL_MAX_CHARS = 20_000;

/** Marker left in place of buffered text dropped by the tail ceiling (bilingual, like the other chat notices). */
const QQ_TAIL_ELIDED = "…(earlier part omitted 前略)…";

/**
 * The refusal for a send with nothing to reply to. A bare Error on purpose: it drops
 * something the chat was meant to receive and has no way to say so (the message that would
 * carry the reason is the message being refused), so the error record is the only place it
 * can be noticed — which is what `unexpected` is for.
 */
function noRepliableMessage(): Error {
  return new Error(
    "QQ only accepts replies to a message sent from QQ, within a few minutes of it — send the bot a message in QQ and it will answer",
  );
}

/**
 * The platform's `file_type` for an outbound file: 1 picture, 2 video, 3 voice, 4 anything
 * else. Only the formats the platform names get their rich form — `.mp4` plays inline and
 * `.silk` is the one voice format it accepts — while everything else (an `.mp3`, a PDF)
 * arrives as a downloadable file card, which is also what the platform itself falls back to
 * for an oversized picture or video.
 */
export function qqFileTypeOf(fileName: string, asImage: boolean): QQFileType {
  if (asImage) return 1;
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "mp4") return 2;
  if (ext === "silk") return 3;
  return 4;
}

/** The platform's refusal of a picture format it will not show as a picture. */
const QQ_UNSUPPORTED_FORMAT_CODE = 850019;

/** The one-line, bilingual note a file's absence leaves in the chat (like the tail's elision marker). */
function mediaNotSentNote(fileName: string, reason: string): string {
  return `[File not sent 文件未发送: ${fileName} — ${reason}]`;
}

/**
 * One inbound event as the bridge's normalized message, media as HANDLES: nothing is
 * downloaded here (see connector.ts), and each handle checks the declared size before it
 * asks for a byte.
 */
function inboundMediaOf(
  transport: QQTransport,
  evt: QQInboundEvent,
): {
  text: string | null;
  images: MessagingInboundImage[];
  files: MessagingInboundFile[];
} {
  const images: MessagingInboundImage[] = [];
  const files: MessagingInboundFile[] = [];
  const transcripts: string[] = [];
  const download = (a: QQAttachment, what: string) => async (maxBytes: number) => {
    if (a.size !== undefined && a.size > maxBytes)
      throw new MessagingMediaTooLargeError(what, maxBytes);
    return transport.fetchAttachment(a.url, maxBytes, what);
  };
  for (const a of evt.attachments ?? []) {
    const type = a.contentType ?? "";
    if (type === "voice") {
      // The recording itself is not handed on: only its transcript can be read downstream.
      if (a.asrText !== undefined) transcripts.push(a.asrText);
    } else if (type.startsWith("image/")) {
      const fetchBytes = download(a, "The image");
      images.push({
        fetch: async (maxBytes) => {
          const data = await fetchBytes(maxBytes);
          // The bytes name their type conclusively where they can; the declared one is the
          // fallback, never `application/octet-stream`, which no provider accepts in a data URL.
          return { data, mimeType: sniffImageMime(data) ?? type };
        },
      });
    } else {
      files.push({
        // The sender's own name where the platform has one; a plain placeholder otherwise,
        // since a made-up extension would tell the model the file is something it is not.
        fileName: a.filename ?? (type === "video/mp4" ? "video.mp4" : "file"),
        fetch: download(a, "The file"),
      });
    }
  }
  const own = [evt.content, ...transcripts].filter((part) => part !== "").join("\n");
  // The quote is context for words the sender wrote, never a message of its own.
  const quote =
    own !== "" && evt.quoted !== undefined
      ? `${evt.quoted
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}\n\n`
      : "";
  return { text: own !== "" ? `${quote}${own}` : null, images, files };
}

/** Narrows a stored config document; throws a readable error on a malformed one. */
export function qqConfigOf(config: Record<string, unknown>): QQBindingConfig {
  const { appId, appSecret } = config;
  if (
    typeof appId !== "string" ||
    appId === "" ||
    typeof appSecret !== "string" ||
    appSecret === ""
  ) {
    throw new Error("malformed qq binding config (appId/appSecret)");
  }
  return { appId, appSecret };
}

/**
 * The chat id the bridge stores and hands back on every outbound send. A QQ chat is a
 * (scene, openid) pair — the same openid can name a user on one side and a group on the
 * other, and the two are answered by different endpoints — so both ride the id.
 */
export function qqChatIdOf(kind: QQChatKind, openid: string): string {
  return `${kind}:${openid}`;
}

/** The inverse; throws on an id this connector did not mint. */
export function parseQQChatId(chatId: string): { kind: QQChatKind; openid: string } {
  const i = chatId.indexOf(":");
  const kind = i > 0 ? chatId.slice(0, i) : "";
  const openid = i > 0 ? chatId.slice(i + 1) : "";
  if ((kind !== "c2c" && kind !== "group") || openid === "") {
    throw new Error(`malformed qq chat id "${chatId}"`);
  }
  return { kind, openid };
}

/**
 * The reply ref: the chat id with the message's own id appended. It is also the bridge's
 * inbound dedupe key, so it must identify the message rather than the delivery — which is
 * exactly what it does, and it matters here more than on the other channels: the platform
 * documents that it may push the same `msg_id` more than once to guarantee delivery.
 */
function qqReplyRefOf(kind: QQChatKind, openid: string, messageId: string): string {
  return `${qqChatIdOf(kind, openid)}:${messageId}`;
}

/** Reads a reply ref back to its chat (the message id is not needed: see the module doc). */
function chatOfReplyRef(ref: string): { kind: QQChatKind; openid: string } {
  const cut = ref.lastIndexOf(":");
  if (cut <= 0) throw new Error(`malformed qq reply ref "${ref}"`);
  return parseQQChatId(ref.slice(0, cut));
}

/**
 * One chat's passive-reply state: which inbound message is currently repliable, how much
 * of its budget is spent, and what is waiting for the reserved final slot.
 *
 * Kept per chat rather than per message on purpose. A reply always anchors to the NEWEST
 * inbound message of its chat, because that is the one furthest from expiring; an older
 * message's remaining budget is worth nothing next to a window that may have minutes left.
 */
interface QQReplyLedger {
  /** The bot this chat belongs to — what a closing connection matches its own ledgers on. */
  appId: string;
  kind: QQChatKind;
  openid: string;
  /** The message replies anchor to; null before the bot has ever been messaged here. */
  msgId: string | null;
  /** When it arrived (the window is measured from here). */
  receivedAt: number;
  /** Replies already sent against `msgId` — also the next `msg_seq`, which must never repeat. */
  spent: number;
  /** Text withheld for the reserved final slot. */
  tail: string[];
  /**
   * Whether the withheld tail goes out as Markdown. The binding's own preference, carried
   * on the chat rather than on each body: it is one saved setting and it does not change
   * within a run, while the tail is combined into a single message that needs one answer.
   */
  markdown: boolean;
  /**
   * The client the last send used, which is the one a deferred flush uses too. Held here
   * rather than passed in: a flush can be triggered by an INBOUND event, whose path has no
   * outbound client of its own, and minting one there would open a second token cache for
   * the same bot. Null until this chat has sent something — and a tail cannot exist before
   * then, so a flush never finds it null.
   */
  bot: QQBotClient | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Sends are serialised per chat: `msg_seq` must increase in the order the platform sees them. */
  chain: Promise<void>;
}

export interface QQConnectorOpts {
  /** Test hook: how long the tail waits for more output before it is sent (default 1500ms). */
  tailFlushMs?: number;
  now?: () => number;
}

export class QQConnector implements MessagingChannelConnector {
  readonly channel = "qq" as const;
  /**
   * The budget channel-neutral callers clamp to — the bridge uses it to cap the
   * one-message-per-line split, whose own ceiling of 20 is meaningless against 4.
   */
  readonly replyBudget = QQ_MIN_REPLY_BUDGET;

  /**
   * Passive-reply state per `(appId, chat)`. It lives on the connector rather than on a
   * client, because the two halves that need it arrive separately: inbound events come
   * through `connect`, and sends through the client `createClient` hands the bridge. The
   * account is part of the key so two bindings on different bots can never spend each
   * other's budget.
   */
  private readonly ledgers = new Map<string, QQReplyLedger>();
  private readonly tailFlushMs: number;
  private readonly now: () => number;

  constructor(
    private readonly transport: QQTransport,
    opts: QQConnectorOpts = {},
  ) {
    this.tailFlushMs = opts.tailFlushMs ?? QQ_TAIL_FLUSH_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  async createClient(config: Record<string, unknown>): Promise<MessagingClient> {
    const creds = qqConfigOf(config);
    const bot = this.transport.createClient(creds);
    const deliver = (
      chatId: string,
      text: string,
      opts: MessagingSendOptions | undefined,
    ): Promise<void> => {
      const { kind, openid } = parseQQChatId(chatId);
      return this.enqueue(creds, bot, kind, openid, text, opts?.markdown === true);
    };
    const client = {
      async checkCredentials(): Promise<null> {
        await bot.checkCredentials();
        // The platform has no call that names the bot, so there is no account label to
        // surface — the App ID the user just typed is the only identity, and echoing it
        // back would confirm nothing.
        return null;
      },
      sendText: (chatId: string, text: string, opts?: MessagingSendOptions) =>
        deliver(chatId, text, opts),
      // Same operation as sendText: `msg_id` is an authorization anchor on QQ, not a
      // visible quote, so there is no threading to honour (see the module doc).
      replyText: (ref: string, text: string, opts?: MessagingSendOptions) => {
        const { kind, openid } = chatOfReplyRef(ref);
        return this.enqueue(creds, bot, kind, openid, text, opts?.markdown === true);
      },
      sendImage: (chatId: string, file: MessagingOutboundFile) =>
        this.sendMedia(creds, bot, chatId, file, true),
      sendFile: (chatId: string, file: MessagingOutboundFile) =>
        this.sendMedia(creds, bot, chatId, file, false),
    };
    return client;
  }

  async connect(
    config: Record<string, unknown>,
    handlers: MessagingConnectorHandlers,
  ): Promise<MessagingConnection> {
    const creds = qqConfigOf(config);
    const connection = await this.transport.openGateway(creds, {
      onMessage: async (evt: QQInboundEvent) => {
        // The ledger learns of the new message BEFORE the bridge does: this is the moment
        // fresh budget exists, and anything the previous message could not fund goes out
        // on it, ahead of whatever this message's own answer will be.
        this.noteInbound(creds, evt);
        await handlers.onMessage({
          chatId: qqChatIdOf(evt.kind, evt.openid),
          chatKind: evt.kind === "c2c" ? "direct" : "group",
          messageId: qqReplyRefOf(evt.kind, evt.openid, evt.messageId),
          ...inboundMediaOf(this.transport, evt),
          ...(evt.senderOpenid !== undefined
            ? { senderId: evt.senderOpenid, senderName: evt.senderOpenid }
            : {}),
        });
      },
      ...(handlers.onReady ? { onReady: handlers.onReady } : {}),
      ...(handlers.onError ? { onError: handlers.onError } : {}),
    });
    return {
      close: () => {
        connection.close();
        // A ledger exists only because THIS gateway delivered an inbound message, and a
        // passive reply may not outlive the binding that earned it: without this, a tail
        // withheld a second ago is sent into the chat after the user turned the connection
        // off, and a tail from before a disable is carried onto the first message after a
        // re-enable. Closing the gateway alone leaves both, because the ledgers hang off
        // the connector rather than off the connection.
        this.dropLedgers(creds.appId);
      },
    };
  }

  // —— The passive-reply budget ————————————————————————————————————————————

  private ledgerKey(appId: string, kind: QQChatKind, openid: string): string {
    return `${appId}:${kind}:${openid}`;
  }

  private ledgerFor(appId: string, kind: QQChatKind, openid: string): QQReplyLedger {
    const key = this.ledgerKey(appId, kind, openid);
    let ledger = this.ledgers.get(key);
    if (ledger === undefined) {
      // Every chat the bot is ever messaged in opens a ledger, each able to hold
      // QQ_TAIL_MAX_CHARS — so the map is swept whenever it is about to grow. Nothing past
      // the reply window can be replied to at all (see repliable), which makes an expired
      // ledger's whole content unusable: its budget funds nothing, and its tail would be
      // dropped by the next noteInbound anyway.
      this.evictExpired();
      ledger = {
        appId,
        kind,
        openid,
        msgId: null,
        receivedAt: 0,
        spent: 0,
        tail: [],
        markdown: false,
        bot: null,
        timer: null,
        chain: Promise.resolve(),
      };
      this.ledgers.set(key, ledger);
    }
    return ledger;
  }

  /** Clears a ledger's pending flush and forgets it. */
  private dropLedger(key: string, ledger: QQReplyLedger): void {
    if (ledger.timer !== null) clearTimeout(ledger.timer);
    this.ledgers.delete(key);
  }

  /** Forgets every ledger of one credential set — the connection's close (see connect). */
  private dropLedgers(appId: string): void {
    for (const [key, ledger] of this.ledgers) {
      if (ledger.appId === appId) this.dropLedger(key, ledger);
    }
  }

  /**
   * Forgets every ledger whose anchor message is past the reply window. An unanchored one
   * is left alone: it holds no budget to lose, and the client that just created it is
   * holding the object.
   */
  private evictExpired(): void {
    for (const [key, ledger] of this.ledgers) {
      if (ledger.msgId === null) continue;
      if (this.now() - ledger.receivedAt <= QQ_PASSIVE_WINDOW_MS) continue;
      this.dropLedger(key, ledger);
    }
  }

  /**
   * A new inbound message: fresh budget, and the moment a withheld tail can finally go out.
   *
   * A tail is carried onto the new budget only while the message it was written for is
   * still inside its own window. Past that it is dropped — the one place anything is — and
   * deliberately: text withheld longer than the platform's whole reply window is no longer
   * an answer to anything the user still has in view, and delivering it as the first thing
   * they see after saying "hi" would read as the bot malfunctioning. The loss is bounded by
   * the same window everything else on this channel is.
   */
  private noteInbound(creds: QQCredentials, evt: QQInboundEvent): void {
    const ledger = this.ledgerFor(creds.appId, evt.kind, evt.openid);
    // A REDELIVERY is not new budget. The platform repeats a `msg_id` to guarantee delivery
    // (see qqReplyRefOf) and the bridge's dedupe runs downstream of this, so a repeat lands
    // here mid-run — re-anchoring to the id already held would reset `spent` to zero and
    // make the next reply reuse a (msg_id, msg_seq) pair the platform has already accepted,
    // which it REFUSES (40054005) rather than deduplicates. Every remaining message of the
    // run would be rejected: half an answer, then silence. Nothing below may run for it,
    // the pending flush included — it is already scheduled against this same anchor.
    if (ledger.msgId === evt.messageId) return;
    if (ledger.timer !== null) {
      clearTimeout(ledger.timer);
      ledger.timer = null;
    }
    const carry = ledger.tail.length > 0 && this.repliable(ledger);
    if (!carry) ledger.tail = [];
    ledger.msgId = evt.messageId;
    ledger.receivedAt = this.now();
    ledger.spent = 0;
    if (carry) this.scheduleFlush(ledger, 0);
  }

  /** True while `ledger.msgId` can still be replied to at all. */
  private repliable(ledger: QQReplyLedger): boolean {
    return ledger.msgId !== null && this.now() - ledger.receivedAt <= QQ_PASSIVE_WINDOW_MS;
  }

  /**
   * One outbound body. Sends immediately while an ordinary slot is free, otherwise
   * withholds it for the reserved final slot; throws when the chat has no repliable
   * message at all, which is the one thing QQ gives no way around (see the module doc).
   */
  private async enqueue(
    creds: QQCredentials,
    bot: QQBotClient,
    kind: QQChatKind,
    openid: string,
    text: string,
    markdown: boolean,
  ): Promise<void> {
    const ledger = this.ledgerFor(creds.appId, kind, openid);
    ledger.bot = bot;
    ledger.markdown = markdown;
    if (!this.repliable(ledger)) {
      // `async` so this is a rejection rather than a synchronous throw: the seam's methods
      // are typed as promises, and a caller that only attaches `.catch` — as any caller
      // reasonably may — would never see a throw raised before the promise exists.
      throw noRepliableMessage();
    }
    const budget = QQ_REPLY_BUDGET[kind];
    if (ledger.spent < budget - 1) {
      await this.chain(ledger, () => this.sendNow(ledger, text, markdown));
      return;
    }
    this.withhold(ledger, text);
    // The final slot is only spendable once. Past it the tail waits for the next inbound
    // message rather than being sent into a rejection.
    if (ledger.spent < budget) this.scheduleFlush(ledger, this.tailFlushMs);
  }

  /**
   * One outbound file: register the bytes, then spend one slot on the `msg_type: 7` message.
   *
   * Runs on the chat's send chain, so the slot check and the sequence number it reserves are
   * exactly as ordered as a text send's, and a text queued behind a slow upload waits for it
   * rather than overtaking. The slot is checked BEFORE the upload: a file with nowhere to go
   * is not worth the transfer.
   *
   * Every way this can fail leaves a note in the chat and throws. The note is the user's half
   * (a file the reply promised and that never came would otherwise be a silent absence — the
   * bridge files its record under the Project, not in the chat); the throw is the operator's
   * (see the bridge's messagingFilesNotSentRecords). A full ledger is a
   * {@link MessagingUnsupportedError}, because the platform's reply cap is a standing shape
   * of the channel that nothing is broken by; a platform refusal rethrows as it came.
   */
  private async sendMedia(
    creds: QQCredentials,
    bot: QQBotClient,
    chatId: string,
    file: MessagingOutboundFile,
    asImage: boolean,
  ): Promise<void> {
    const { kind, openid } = parseQQChatId(chatId);
    const ledger = this.ledgerFor(creds.appId, kind, openid);
    ledger.bot = bot;
    if (!this.repliable(ledger)) throw noRepliableMessage();
    await this.chain(ledger, async () => {
      // Re-checked inside the chain: the window may have closed while this waited its turn.
      if (!this.repliable(ledger)) throw noRepliableMessage();
      const budget = QQ_REPLY_BUDGET[kind];
      if (ledger.tail.length > 0 || ledger.spent >= budget) {
        const reason = `QQ allows only ${budget} replies to one message and none is free`;
        this.noteMediaNotSent(ledger, file.fileName, reason);
        throw new MessagingUnsupportedError(`${reason} for a file`);
      }
      try {
        const fileType = qqFileTypeOf(file.fileName, asImage);
        const upload = (type: QQFileType): Promise<string> =>
          bot.uploadFile({
            kind,
            openid,
            fileType: type,
            fileName: file.fileName,
            data: file.data,
          });
        let fileInfo: string;
        try {
          fileInfo = await upload(fileType);
        } catch (err) {
          // A picture format the platform will not show as a picture (it lists png and jpg;
          // gif and webp are accepted on some accounts and not others) still goes out as a
          // file card — better the file than a refusal.
          if (
            !(err instanceof QQApiError) ||
            err.code !== QQ_UNSUPPORTED_FORMAT_CODE ||
            fileType !== 1
          ) {
            throw err;
          }
          fileInfo = await upload(4);
        }
        // Reserved before the await, as sendNow does: a rejected send has still consumed its
        // sequence number and a repeated pair is refused rather than retried.
        ledger.spent += 1;
        await bot.sendMessage({
          kind,
          openid,
          content: "",
          msgId: ledger.msgId!,
          msgSeq: ledger.spent,
          fileInfo,
        });
      } catch (err) {
        this.noteMediaNotSent(
          ledger,
          file.fileName,
          err instanceof Error ? err.message : String(err),
        );
        throw err;
      }
    });
  }

  /** Leaves the chat a one-line account of a file that did not arrive, as a withheld text. */
  private noteMediaNotSent(ledger: QQReplyLedger, fileName: string, reason: string): void {
    this.withhold(ledger, mediaNotSentNote(fileName, reason));
    if (ledger.spent < QQ_REPLY_BUDGET[ledger.kind]) this.scheduleFlush(ledger, this.tailFlushMs);
  }

  /** Appends to the withheld tail, dropping from the FRONT if the ceiling is reached. */
  private withhold(ledger: QQReplyLedger, text: string): void {
    ledger.tail.push(text);
    let total = ledger.tail.reduce((n, part) => n + part.length + 2, 0);
    while (total > QQ_TAIL_MAX_CHARS && ledger.tail.length > 1) {
      const dropped = ledger.tail.shift();
      total -= (dropped?.length ?? 0) + 2;
      if (ledger.tail[0] !== QQ_TAIL_ELIDED) ledger.tail.unshift(QQ_TAIL_ELIDED);
    }
  }

  private scheduleFlush(ledger: QQReplyLedger, delayMs: number): void {
    if (ledger.timer !== null) clearTimeout(ledger.timer);
    ledger.timer = setTimeout(() => {
      ledger.timer = null;
      void this.chain(ledger, () => this.flush(ledger)).catch(() => {});
    }, delayMs);
    // A pending flush must never be the reason the process cannot exit.
    ledger.timer.unref?.();
  }

  /**
   * Spends the reserved final slot on everything withheld, as one message. A combined tail
   * over the channel's size cap is chunked as usual and only its FIRST chunk is sent — the
   * rest returns to the tail, to ride the next inbound message's budget rather than a
   * rejection.
   */
  private async flush(ledger: QQReplyLedger): Promise<void> {
    if (ledger.tail.length === 0) return;
    if (!this.repliable(ledger) || ledger.spent >= QQ_REPLY_BUDGET[ledger.kind]) return;
    const combined = ledger.tail.join("\n\n");
    // Chunked the same way the bridge chunks a reply, so the cut lands where the document
    // has a boundary rather than through a construct (see markdown.ts chunkMarkdown).
    const chunks = ledger.markdown
      ? chunkMarkdown(combined, MESSAGING_TEXT_CHUNK_CHARS)
      : chunkMessagingText(combined);
    const head = chunks[0];
    if (head === undefined) {
      ledger.tail = [];
      return;
    }
    ledger.tail = chunks.slice(1);
    try {
      await this.sendNow(ledger, head, ledger.markdown);
    } catch (err) {
      // The slot is spent (sendNow reserves the sequence number before the wire) but the
      // TEXT is not lost: `head` goes back to the front of the tail, so the next inbound
      // message's budget carries it. Anything withheld while the send was in flight was
      // appended to that same array and keeps its place behind it.
      ledger.tail.unshift(head);
      throw err;
    }
  }

  /**
   * One real send: the next `msg_seq` against the ledger's anchor message, as Markdown when
   * the binding asked for it and as plain text if the platform refuses that.
   *
   * The fallback costs a SLOT here, which it does on no other channel: a repeated
   * `(msg_id, msg_seq)` pair is refused rather than deduplicated, so the retry must carry a
   * fresh sequence number and that number is one of the four an inbound message funds. It is
   * still the right trade — a reply the reader never sees is worse than a reply that spent
   * an extra slot — but it is only taken while a slot remains, and never for a refusal that
   * was not about the body in the first place (see QQ_BODY_INDEPENDENT_SEND_CODES): those
   * would fail identically as text and burn the slot reserved for the withheld tail.
   */
  private async sendNow(ledger: QQReplyLedger, text: string, markdown: boolean): Promise<void> {
    const msgId = ledger.msgId;
    const bot = ledger.bot;
    if (msgId === null || bot === null) return;
    const send = (body: Partial<{ markdown: string }>): Promise<void> => {
      // Reserved before the await: a rejected send has still consumed its sequence number,
      // and reusing one is refused by the platform (40054005) rather than retried.
      ledger.spent += 1;
      return bot.sendMessage({
        kind: ledger.kind,
        openid: ledger.openid,
        content: text,
        ...body,
        msgId,
        msgSeq: ledger.spent,
      });
    };
    if (!markdown) return send({});
    try {
      await send({ markdown: qqMarkdownOf(text) });
      return;
    } catch (err) {
      if (!(err instanceof QQApiError)) throw err;
      if (err.code !== undefined && QQ_BODY_INDEPENDENT_SEND_CODES.has(err.code)) throw err;
      if (ledger.spent >= QQ_REPLY_BUDGET[ledger.kind]) throw err;
    }
    await send({});
  }

  /**
   * Appends to the chat's send chain. Two sends against one `msg_id` must reach the
   * platform in `msg_seq` order, and the chain never rejects — the caller's promise carries
   * the failure, and one failed send must not poison the chat's later ones.
   */
  private chain(ledger: QQReplyLedger, run: () => Promise<void>): Promise<void> {
    const result = ledger.chain.then(run);
    ledger.chain = result.catch(() => {});
    return result;
  }
}

/** The qq connector, contributed to messaging.connectors like any third-party one would be. */
@Component({
  contributes: {
    "MessagingModule.connectors": [
      {
        id: "messaging-qq.connector",
        channel: "qq",
      },
    ],
  },
})
export class QqMessaging {
  @Use() private readonly qq!: QQTransportHandle;
  @Use() private readonly tuning!: MessagingTuning;
  @Use() private readonly clock!: MessagingClock;
  @Bind("messaging-qq.connector") connector!: MessagingChannelConnector;
  setup() {
    const { qqTailFlushMs } = this.tuning;
    this.connector = new QQConnector(this.qq.transport, {
      ...(qqTailFlushMs !== undefined ? { tailFlushMs: qqTailFlushMs } : {}),
      now: () => this.clock.now().getTime(),
    });
  }
}

/** The QQ OpenAPI + gateway transport as a node, so a test stands in a fake for the network. */
@Interface()
export abstract class QQTransportHandle {
  abstract transport: Opaque<"QQTransport", QQTransport>;
}
@Module()
export class QQTransportProvider {
  @Provide() qqTransport!: QQTransportHandle;
  setup() {
    this.qqTransport = { transport: createQQTransport() };
  }
}
