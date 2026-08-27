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
 * Text only, in both directions. Inbound images are not normalized (a non-text message
 * reads as no text, which the bridge answers with its notice) and outbound files are
 * refused with a reason — see refuseMedia, which explains what QQ would require.
 */
import { chunkMessagingText } from "./bridge.js";
import type {
  MessagingChannelConnector,
  MessagingClient,
  MessagingConnection,
  MessagingConnectorHandlers,
} from "./connector.js";
import type {
  QQBotClient,
  QQChatKind,
  QQCredentials,
  QQInboundEvent,
  QQTransport,
} from "./qq-api.js";

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
 * The bridge's outbound-file shape, mirrored structurally rather than imported: it is a
 * two-field record, and matching it by structure keeps this connector compiling against a
 * seam it never adds to.
 */
interface QQOutboundFile {
  fileName: string;
  data: Buffer;
}

/**
 * Outbound media, refused rather than faked.
 *
 * QQ does have a rich-media path, and this product cannot reach it. Sending a picture on
 * API v2 is a two-step: the bytes are first registered against `/v2/{users,groups}/…/files`,
 * which takes a PUBLICLY REACHABLE https URL — the same requirement that ruled the webhook
 * mode out and made this a gateway connection in the first place — and only then can a
 * `msg_type: 7` message reference the handle it returns. Documents are worse still: the
 * platform lists a file type and does not open it. And any such message would spend a slot
 * from the same passive-reply budget the text is already rationing.
 *
 * So the honest answer is a refusal that names the reason. The bridge records one error per
 * undeliverable file and the reply's text still arrives — quietly resolving would tell it a
 * picture reached a chat that never received one.
 */
function refuseMedia(file: QQOutboundFile): Promise<never> {
  return Promise.reject(
    new Error(
      `QQ cannot receive "${file.fileName}": sending a file to QQ requires a publicly reachable URL for it, which this server has no way to provide`,
    ),
  );
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
    const deliver = (chatId: string, text: string): Promise<void> => {
      const { kind, openid } = parseQQChatId(chatId);
      return this.enqueue(creds, bot, kind, openid, text);
    };
    // Assembled into a variable rather than returned as a literal: the media methods below
    // are refusals rather than implementations, and a channel that grows one later should
    // be able to fill them in without the shape of this function changing.
    const client = {
      async checkCredentials(): Promise<null> {
        await bot.checkCredentials();
        // The platform has no call that names the bot, so there is no account label to
        // surface — the App ID the user just typed is the only identity, and echoing it
        // back would confirm nothing.
        return null;
      },
      sendText: (chatId: string, text: string) => deliver(chatId, text),
      // Same operation as sendText: `msg_id` is an authorization anchor on QQ, not a
      // visible quote, so there is no threading to honour (see the module doc).
      replyText: (ref: string, text: string) => {
        const { kind, openid } = chatOfReplyRef(ref);
        return this.enqueue(creds, bot, kind, openid, text);
      },
      sendImage: (_chatId: string, file: QQOutboundFile) => refuseMedia(file),
      sendFile: (_chatId: string, file: QQOutboundFile) => refuseMedia(file),
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
          // Only text is read today; an empty content is every non-text message type
          // (image, voice, card, forwarded record), which the bridge answers with the
          // text-only notice. Inbound media is a follow-up, not a gap.
          text: evt.content !== "" ? evt.content : null,
          ...(evt.senderOpenid !== undefined ? { senderName: evt.senderOpenid } : {}),
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
  ): Promise<void> {
    const ledger = this.ledgerFor(creds.appId, kind, openid);
    ledger.bot = bot;
    if (!this.repliable(ledger)) {
      // `async` so this is a rejection rather than a synchronous throw: the seam's methods
      // are typed as promises, and a caller that only attaches `.catch` — as any caller
      // reasonably may — would never see a throw raised before the promise exists.
      throw new Error(
        "QQ only accepts replies to a message sent from QQ, within a few minutes of it — send the bot a message in QQ and it will answer",
      );
    }
    const budget = QQ_REPLY_BUDGET[kind];
    if (ledger.spent < budget - 1) {
      await this.chain(ledger, () => this.sendNow(ledger, text));
      return;
    }
    this.withhold(ledger, text);
    // The final slot is only spendable once. Past it the tail waits for the next inbound
    // message rather than being sent into a rejection.
    if (ledger.spent < budget) this.scheduleFlush(ledger, this.tailFlushMs);
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
    const chunks = chunkMessagingText(ledger.tail.join("\n\n"));
    const head = chunks[0];
    if (head === undefined) {
      ledger.tail = [];
      return;
    }
    ledger.tail = chunks.slice(1);
    try {
      await this.sendNow(ledger, head);
    } catch (err) {
      // The slot is spent (sendNow reserves the sequence number before the wire) but the
      // TEXT is not lost: `head` goes back to the front of the tail, so the next inbound
      // message's budget carries it. Anything withheld while the send was in flight was
      // appended to that same array and keeps its place behind it.
      ledger.tail.unshift(head);
      throw err;
    }
  }

  /** One real send: the next `msg_seq` against the ledger's anchor message. */
  private async sendNow(ledger: QQReplyLedger, text: string): Promise<void> {
    const msgId = ledger.msgId;
    const bot = ledger.bot;
    if (msgId === null || bot === null) return;
    // Reserved before the await: a rejected send has still consumed its sequence number,
    // and reusing one is refused by the platform (40054005) rather than retried.
    ledger.spent += 1;
    await bot.sendMessage({
      kind: ledger.kind,
      openid: ledger.openid,
      content: text,
      msgId,
      msgSeq: ledger.spent,
    });
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
