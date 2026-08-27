/**
 * The messaging-channel connector seam: what the MessagingBridge needs from one chat
 * platform (Feishu, Telegram and QQ today; further channels implement the same interface
 * and register in app assembly). A connector owns everything channel-specific — credential
 * shape, wire protocol, event normalization — and hands the bridge a channel-neutral
 * view: a client for outbound sends and credential checks, and a long-lived event
 * connection delivering normalized inbound messages.
 *
 * Config documents are the repo's stored per-channel JSON (`MessagingBindingRow.config`);
 * every connector method validates its own shape and throws a readable error on a
 * malformed one — the bridge treats that like any other channel failure.
 */

/** Known messaging channels (the DB stores the discriminator as text; unknown values are skipped defensively). */
export type MessagingChannel = "feishu" | "telegram" | "qq";

/** One inbound image's bytes, once fetched, with the MIME type the bridge needs for its data URL. */
export interface MessagingInboundImageData {
  data: Buffer;
  /** e.g. `image/png` — the connector's best answer, from the channel's own type or the bytes. */
  mimeType: string;
}

/**
 * An image attached to an inbound message: a handle, not the bytes.
 *
 * The bytes are deliberately NOT eagerly downloaded by the connector. Most of what makes
 * an inbound message uninteresting is decided after the event is normalized — a
 * redelivery is dropped before anything else happens — and a channel that downloaded
 * first would pay a full image transfer for every replay. Fetching lazily also puts the
 * cap where the transfer is: `fetch` refuses anything over `maxBytes` rather than handing
 * the bridge something it would only discard, which is what keeps a 100MB attachment from
 * ever being resident in this process.
 */
export interface MessagingInboundImage {
  /**
   * Downloads the image, throwing when it is larger than `maxBytes` or the transfer fails.
   * Both outcomes read the same to the bridge, which answers either with one notice — the
   * user's next move ("send a smaller one") is the same in both cases.
   */
  fetch(maxBytes: number): Promise<MessagingInboundImageData>;
}

/** One inbound chat message, normalized across channels. */
export interface MessagingInboundMessage {
  /**
   * Channel-scoped chat id, and the reply target for direct chats. Opaque to the bridge, for
   * the same reason `messageId` is: the connector both mints it here and consumes it in
   * `sendText`, so a channel whose replies need more routing context than a chat identity
   * encodes it (Telegram appends the forum topic). It is stored verbatim as the binding's
   * last known chat, so whatever is encoded here is what survives a restart.
   */
  chatId: string;
  /** Direct chat with the bot, or a group chat (groups prefer reply-to-message). */
  chatKind: "direct" | "group";
  /**
   * Channel-scoped id of the inbound message itself (the group reply target). Opaque to
   * the bridge: the connector both mints it here and consumes it in `replyText`, so a
   * channel whose native message ids are not globally unique encodes whatever context a
   * reply needs (Telegram packs `chatId:messageId`). It is also the bridge's inbound
   * dedupe key, so it must identify the MESSAGE and not the delivery: a channel that
   * redelivers one message must mint the same id both times. `""` opts the channel out of
   * deduplication entirely — the honest answer for a connector with no message identity,
   * and better than every message after the first reading as a duplicate.
   */
  messageId: string;
  /**
   * The message's plain text; null for anything that carries none (stickers, voice,
   * files, …) — a message with neither text nor images gets the not-supported notice.
   * An image sent with a caption puts the caption here: the caption IS that message's
   * text, so a channel needs no second field for it and the bridge no second rule.
   */
  text: string | null;
  /**
   * Images attached to this message (absent or empty when there are none). Handles rather
   * than bytes — see MessagingInboundImage. A channel that carries several images in one
   * message lists them in the order the user sees them.
   */
  images?: readonly MessagingInboundImage[];
  /** Sender display name when the channel's event carries one. */
  senderName?: string;
}

export interface MessagingConnectorHandlers {
  onMessage(msg: MessagingInboundMessage): void | Promise<void>;
  /** The connection completed a handshake (may fire again after an automatic reconnect). */
  onReady?(): void;
  /** The connection failed and the channel gave up (or the initial connect failed). */
  onError?(err: unknown): void;
}

/** A live inbound event stream; `close` ends it (idempotent). */
export interface MessagingConnection {
  close(): void;
}

/**
 * A successful credential check's optional payload: whatever the probe learned that the test
 * endpoint's feedback can act on. Every member is independently optional — a channel reports
 * the ones its check happens to answer and omits the rest, so a check that learned nothing
 * beyond "these credentials work" returns an empty object.
 */
export interface MessagingAccountInfo {
  /** A short human-readable label of the account the credentials sign in as (Telegram: the bot's `@username`). */
  accountLabel?: string;
  /**
   * Whether this ACCOUNT is set up to receive ordinary messages in the groups it belongs to
   * — as opposed to only the ones a platform hands a bot by default.
   *
   * Telegram's privacy mode is the case that needs saying: it is on for every bot whose
   * owner has not turned it off in @BotFather, and under it `getUpdates` simply omits
   * everything in a group that is not a command addressed to this bot or a reply to one of
   * its messages. Nothing errors — the messages are never delivered, so a binding that works
   * perfectly in a direct chat looks dead in a group. It is one account-wide setting and
   * Telegram overrides it in any group the bot administers, so `false` says the account is
   * muted where it is an ordinary member, never that some particular group is silent. Absent
   * when the channel has no such notion, or reports nothing about it: unknown must never be
   * reported as a problem.
   */
  readsGroupMessages?: boolean;
}

/**
 * What a send had to give up in order to land, as a short readable phrase. The message DID
 * arrive — a send that did not throws — so this is not a failure: it says the message is
 * somewhere less right than it was addressed to, which is otherwise invisible from the
 * outside. A channel that always delivers as addressed returns nothing at all; Telegram is
 * the one that reports, a forum topic deleted under a live conversation sending the reply to
 * General instead.
 */
export type MessagingSendNote = string;

/** One file on its way out to a chat: the bytes, plus the name the chat should show. */
export interface MessagingOutboundFile {
  /** Display name — the base name of the Workspace-relative path the reply mentioned. */
  fileName: string;
  data: Buffer;
}

/** Outbound half of one bound account. Every method throws on failure with a readable reason. */
export interface MessagingClient {
  /** Credential check (used by the test endpoint); resolving means the config signs in. */
  checkCredentials(): Promise<MessagingAccountInfo | null>;
  /** Sends a text message into a chat by chat id; resolves a MessagingSendNote when it degraded. */
  sendText(chatId: string, text: string): Promise<MessagingSendNote | void>;
  /** Replies a text message to a specific inbound message (threads correctly in group chats). */
  replyText(messageId: string, text: string): Promise<MessagingSendNote | void>;
  /**
   * Sends a picture into a chat, so a chart the Agent drew arrives as something the reader
   * can see rather than as a download. Channels that need an upload step first do it here —
   * the bridge holds bytes and a name, never a channel's file handle.
   */
  sendImage(chatId: string, file: MessagingOutboundFile): Promise<void>;
  /** Sends any other file into a chat as an attachment. */
  sendFile(chatId: string, file: MessagingOutboundFile): Promise<void>;
}

export interface MessagingChannelConnector {
  readonly channel: MessagingChannel;
  /**
   * How many outbound messages this channel will accept in answer to ONE inbound message,
   * or undefined where no such limit exists (Feishu and Telegram both send freely).
   *
   * A channel that declares one enforces it itself — the connector is the only place that
   * knows what the platform rejects and how to combine messages so nothing is lost. What
   * the bridge does with the number is narrower: it caps the one-message-per-line split at
   * it, because that option's own ceiling is sized for a channel with no such budget and
   * would otherwise ask for more messages than the channel can ever deliver.
   */
  readonly replyBudget?: number;
  /** Builds the outbound client for one stored config (throws on a malformed document). */
  createClient(config: Record<string, unknown>): Promise<MessagingClient>;
  /**
   * Opens the inbound event stream for one stored config. Resolves as soon as the
   * connection is constructed and connecting — lifecycle arrives via the handlers
   * (`onReady` / `onError`), because channels reconnect on their own and a single promise
   * cannot carry a lifecycle.
   */
  connect(
    config: Record<string, unknown>,
    handlers: MessagingConnectorHandlers,
  ): Promise<MessagingConnection>;
}
