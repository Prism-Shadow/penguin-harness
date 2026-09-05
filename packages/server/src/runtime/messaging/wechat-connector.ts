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
 * webhook mode not. The loop's lifecycle mirrors telegram-connector's: failures back off and
 * report once per outage, and a recovery fires `onReady` again so the bridge's status tracks
 * the outage.
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
 * A blip is not affected, because a reconnect keeps the cursor it already had.
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
import { WECHAT_API_BASE, createWeChatTransport } from "./wechat-api.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Overrides } from "../../app.js";
import { RuntimeModule } from "../../hmr/capabilities.js";

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
    /** The credential probe has answered since the last failure, and onReady fired for it. */
    let ready = false;
    /** The backlog drain runs once per connection, never again after an outage (see the module doc). */
    let drained = false;
    /** Drains that closed on their deadline without the platform answering. */
    let drainAttempts = 0;
    let failures = 0;
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
        if (!drained) {
          // The cursor above is kept; these messages are not. Everything from before the
          // connection existed is confirmed rather than relayed.
          //
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
  @Use(RuntimeModule) private readonly overrides!: Overrides;
  @Bind("messaging-wechat.connector") connector!: MessagingChannelConnector;
  setup() {
    const overrides = this.overrides.value();
    this.connector = new WeChatConnector(
      overrides.wechatTransport ?? createWeChatTransport(),
      overrides.wechatRetryDelayMs ? { retryDelayMs: overrides.wechatRetryDelayMs } : {},
    );
  }
}
