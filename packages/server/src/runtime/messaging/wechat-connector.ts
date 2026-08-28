/**
 * WeChat messaging connector — the fourth implementation of the MessagingChannelConnector
 * seam, over the official claw bot channel. It owns everything WeChat-specific: the config
 * document a scan produces, the transport behind it (injectable for tests — see
 * wechat-api.ts), the long-poll loop that stands in for an event stream, and the context
 * token that threads an outbound send back onto the conversation it answers.
 *
 * ## Inbound is a poll, and there is no webhook anywhere
 *
 * The platform holds `getupdates` open until a message arrives, and the client passes back
 * the opaque cursor it was last given. Nothing in the flow wants a publicly reachable URL —
 * the property that made Telegram's `getUpdates` and QQ's gateway usable here, and QQ's
 * webhook mode not. The loop's lifecycle mirrors telegram-connector's: failures back off,
 * report once per outage, and a recovered poll fires `onReady` again so the bridge's status
 * tracks the outage.
 *
 * ## The first poll is a DRAIN
 *
 * An empty cursor means "start from the beginning", so the first poll of a connection can
 * return everything sent while nothing was connected. Its messages are dropped and only its
 * cursor is kept — the same choice telegram-connector makes with `offset: -1`, for the same
 * reason: a binding switched on after a week dark must not replay that week as a task flood.
 * A blip is not affected, because a reconnect keeps the cursor it already had.
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
 * Text, images and files travel in BOTH directions, and nothing outbound is refused — the
 * widest of the four channels here, where QQ refuses outbound media outright and the other
 * two carry it at a permission's mercy.
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
 * ## The context token
 *
 * Every inbound message carries one, and echoing it on a send is what puts the reply in the
 * right conversation. It is held per (bot, user) in memory only: it is derived from traffic,
 * and the platform accepts a send without one, so persisting it would add a place for a
 * conversation handle to sit at rest in exchange for nothing a fresh inbound message does
 * not fix. A send before this connection has seen any message from that user goes without —
 * which is exactly what "send test message" does after a restart.
 */
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
import { wechatMarkdownOf } from "./wechat-markdown.js";
import type {
  WeChatBotClient,
  WeChatCredentials,
  WeChatInboundEvent,
  WeChatTransport,
} from "./wechat-api.js";
import { WECHAT_API_BASE } from "./wechat-api.js";

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

export interface WeChatConnectorOpts {
  /** Test hook: the poll loop's backoff (tests collapse it to zero). */
  retryDelayMs?: (failures: number) => number;
}

export class WeChatConnector implements MessagingChannelConnector {
  readonly channel = "wechat" as const;

  /**
   * The most recent context token per `(botId, userId)`.
   *
   * On the connector rather than on a client because the two halves that need it arrive
   * separately: tokens come in through `connect`, and sends go out through the client
   * `createClient` hands the bridge. The bot is part of the key so two bindings on different
   * bots can never spend each other's conversation handles.
   */
  private readonly contextTokens = new Map<string, string>();
  private readonly retryDelayMs: (failures: number) => number;

  constructor(
    private readonly transport: WeChatTransport,
    opts: WeChatConnectorOpts = {},
  ) {
    this.retryDelayMs = opts.retryDelayMs ?? wechatRetryDelayMs;
  }

  async createClient(config: Record<string, unknown>): Promise<MessagingClient> {
    const creds = credsOf(config);
    const bot = this.transport.createClient(creds);
    /** One send's arguments: the rendered body, and this conversation's token when known. */
    const args = (userId: string, text: string, opts?: MessagingSendOptions) => {
      const contextToken = this.contextTokens.get(this.tokenKey(creds.botId, userId));
      return {
        userId,
        text: opts?.markdown === true ? wechatMarkdownOf(text) : text,
        ...(contextToken !== undefined ? { contextToken } : {}),
      };
    };
    return {
      async checkCredentials(): Promise<null> {
        await bot.checkCredentials();
        // `getconfig` answers with a typing ticket and nothing that names the bot or the
        // account, so there is no label to surface — the same shape as QQ's probe.
        return null;
      },
      sendText: (chatId: string, text: string, opts?: MessagingSendOptions) =>
        bot.sendText(args(chatId, text, opts)),
      // The same operation as sendText: this channel has no quote relation to thread onto
      // (see the module doc), so the anchor is read only for the chat it names.
      replyText: (ref: string, text: string, opts?: MessagingSendOptions) =>
        bot.sendText(args(chatOfWeChatReplyRef(ref), text, opts)),
      sendImage: (chatId: string, file: MessagingOutboundFile) =>
        // The caption is empty because the bridge sends a reply's text as its own message:
        // a picture here is the picture, and pairing it would duplicate what already went.
        bot.sendImage({ ...args(chatId, ""), file }),
      sendFile: (chatId: string, file: MessagingOutboundFile) =>
        bot.sendFile({ ...args(chatId, ""), file }),
    };
  }

  async connect(
    config: Record<string, unknown>,
    handlers: MessagingConnectorHandlers,
  ): Promise<MessagingConnection> {
    const creds = credsOf(config);
    const bot = this.transport.createClient(creds);
    const abort = new AbortController();
    let closed = false;
    void this.poll(creds, bot, handlers, abort.signal, () => closed);
    return {
      close: () => {
        closed = true;
        abort.abort();
        // A conversation handle may not outlive the binding that learned it: without this, a
        // token from before a disable would be echoed onto the first send after a re-enable,
        // addressing a conversation the user has since ended.
        this.dropTokens(creds.botId);
      },
    };
  }

  private tokenKey(botId: string, userId: string): string {
    return `${botId}:${userId}`;
  }

  /** Forgets every conversation handle of one bot — the connection's close (see connect). */
  private dropTokens(botId: string): void {
    const prefix = `${botId}:`;
    for (const key of this.contextTokens.keys()) {
      if (key.startsWith(prefix)) this.contextTokens.delete(key);
    }
  }

  private async poll(
    creds: WeChatCredentials,
    bot: WeChatBotClient,
    handlers: MessagingConnectorHandlers,
    signal: AbortSignal,
    isClosed: () => boolean,
  ): Promise<void> {
    /** A poll has succeeded since the last failure, and onReady fired for that up-streak. */
    let ready = false;
    /** The backlog drain runs once per connection, never again after an outage (see the module doc). */
    let drained = false;
    let failures = 0;
    let cursor = "";
    while (!isClosed()) {
      try {
        const { messages, cursor: next } = await bot.getUpdates({ cursor, signal });
        if (isClosed()) return;
        cursor = next;
        if (!ready) {
          ready = true;
          failures = 0;
          handlers.onReady?.();
        }
        if (!drained) {
          // The cursor above is kept; these messages are not. Everything from before the
          // connection existed is confirmed rather than relayed.
          drained = true;
          continue;
        }
        for (const evt of messages) {
          if (isClosed()) return;
          // The token is learned BEFORE the bridge is told, so the reply to this very
          // message is already addressed to the right conversation.
          if (evt.contextToken !== undefined) {
            this.contextTokens.set(this.tokenKey(creds.botId, evt.userId), evt.contextToken);
          }
          await handlers.onMessage(inboundOf(bot, evt));
        }
      } catch (err) {
        if (isClosed()) return;
        ready = false;
        failures += 1;
        // Reported once per outage, not once per attempt: a token revoked overnight would
        // otherwise write one error record per retry until somebody looked.
        if (failures === 1) handlers.onError?.(err);
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
