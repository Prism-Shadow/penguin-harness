/**
 * The messaging-channel connector seam: what the MessagingBridge needs from one chat
 * platform (Feishu today; further channels implement the same interface and register in
 * app assembly). A connector owns everything channel-specific — credential shape, wire
 * protocol, event normalization — and hands the bridge a channel-neutral view: a client
 * for outbound sends and credential checks, and a long-lived event connection delivering
 * normalized inbound messages.
 *
 * Config documents are the repo's stored per-channel JSON (`MessagingBindingRow.config`);
 * every connector method validates its own shape and throws a readable error on a
 * malformed one — the bridge treats that like any other channel failure.
 */

/** Known messaging channels (the DB stores the discriminator as text; unknown values are skipped defensively). */
export type MessagingChannel = "feishu";

/** One inbound chat message, normalized across channels. */
export interface MessagingInboundMessage {
  /** Channel-scoped chat id (the reply target for direct chats). */
  chatId: string;
  /** Direct chat with the bot, or a group chat (groups prefer reply-to-message). */
  chatKind: "direct" | "group";
  /** Channel-scoped id of the inbound message itself (the group reply target). */
  messageId: string;
  /**
   * The message's plain text; null for anything that is not a text message (stickers,
   * images, …) — the bridge answers those with the text-only notice.
   */
  text: string | null;
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

/** Outbound half of one bound account. Every method throws on failure with a readable reason. */
export interface MessagingClient {
  /** Credential check (used by the test endpoint); resolving means the config signs in. */
  checkCredentials(): Promise<void>;
  /** Sends a text message into a chat by chat id. */
  sendText(chatId: string, text: string): Promise<void>;
  /** Replies a text message to a specific inbound message (threads correctly in group chats). */
  replyText(messageId: string, text: string): Promise<void>;
}

export interface MessagingChannelConnector {
  readonly channel: MessagingChannel;
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
