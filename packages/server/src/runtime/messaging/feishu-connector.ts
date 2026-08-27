/**
 * Feishu (Lark) messaging connector — the first implementation of the
 * MessagingChannelConnector seam (telegram-connector.ts is the second). It owns
 * everything Feishu-specific: the config document's shape, the SDK adapter behind it
 * (injectable for tests — see feishu-sdk.ts), and the reduction of
 * `im.message.receive_v1` events to the bridge's normalized inbound shape (text extracted
 * from the content JSON and its mention placeholders resolved — see resolveFeishuMentions,
 * an `image` message's `image_key` turned into a lazy download handle; anything else
 * reads as neither text nor image).
 */
import type {
  MessagingChannelConnector,
  MessagingClient,
  MessagingConnection,
  MessagingConnectorHandlers,
  MessagingInboundImage,
} from "./connector.js";
import type { FeishuApiClient, FeishuCredentials, FeishuMention, FeishuSdk } from "./feishu-sdk.js";

/** Default Feishu open-platform domain (Lark tenants override it in the form). */
export const FEISHU_DEFAULT_DOMAIN = "https://open.feishu.cn";

/** The Feishu binding's stored config document (`messaging_bindings.config_json`). */
export interface FeishuBindingConfig extends Record<string, unknown> {
  appId: string;
  appSecret: string;
  baseDomain: string;
}

/** Narrows a stored config document; throws a readable error on a malformed one. */
export function feishuConfigOf(config: Record<string, unknown>): FeishuBindingConfig {
  const { appId, appSecret } = config;
  const baseDomain = config.baseDomain ?? FEISHU_DEFAULT_DOMAIN;
  if (
    typeof appId !== "string" ||
    appId === "" ||
    typeof appSecret !== "string" ||
    appSecret === "" ||
    typeof baseDomain !== "string"
  ) {
    throw new Error("malformed feishu binding config (appId/appSecret/baseDomain)");
  }
  return { appId, appSecret, baseDomain };
}

/** The `text` field of a Feishu text message's content JSON (null when unparseable). */
function textOfContent(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : null;
  } catch {
    return null;
  }
}

/** Escapes a mention key for embedding in a RegExp (keys are `@_user_N`, but keep this honest). */
function escapeKey(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One alternation over every mention key, longest key first.
 *
 * Two things make it a single regex rather than a substitution per key. Feishu numbers its
 * placeholders `@_user_1`, `@_user_2`, … — so once a message mentions ten people, `@_user_1`
 * is a prefix of `@_user_10`, and an ordered alternation lets the longer key win wherever
 * both could match. And one regex means ONE left-to-right pass over the original text: key
 * by key, every later key re-scans what the earlier ones already wrote, so a mentioned
 * party whose display name reads like a placeholder gets replaced a second time.
 */
function mentionKeyRegex(mentions: readonly FeishuMention[]): RegExp {
  const keys = [...mentions]
    .sort((a, b) => b.key.length - a.key.length)
    .map((m) => escapeKey(m.key));
  return new RegExp(keys.join("|"), "g");
}

/**
 * Rewrites a message's text into what the user actually wrote.
 *
 * Feishu never puts a mention in the text: it writes a placeholder (`@_user_1`) and carries
 * who it refers to in a parallel `mentions` array. Handed to the model raw, that is a token
 * nothing in the conversation can resolve — a group message reads as `@_user_1 你好` and the
 * model spends its turn asking who `_user_1` is. Every placeholder therefore becomes the
 * mentioned party's name.
 *
 * A LEADING mention of this bot is dropped instead of named, when its open id is known: the
 * bridge feeds inbound text to the model exactly as if it had been typed into the web
 * composer, and a `@PenguinHarness` in front of the sentence would announce the channel the
 * message came through. Only that addressing prefix goes — this bot named further in ("why
 * did @PenguinHarness stop replying?") is a word the user chose, and it reads as itself like
 * anyone else's. An unknown id (see FeishuApiClient.botOpenId) only means the prefix is named
 * too — the confusion the placeholder caused is gone either way.
 *
 * Each key is substituted at its FIRST occurrence only: Feishu emits one placeholder per key,
 * so anything further along that spells the same key is a token the user typed by hand, and
 * it stays as typed.
 *
 * Returns `""` when the message carries nothing but mentions — someone `@`-ed the bot and
 * typed no words — because there is no message there to run a Task on. The emptiness is
 * judged with EVERY placeholder removed, not just this bot's, so it holds whether or not
 * the bot's own id was resolved.
 */
export function resolveFeishuMentions(
  text: string,
  mentions: readonly FeishuMention[] | undefined,
  botOpenId: string | null,
): string {
  // An empty key would match at every position: a malformed event does not get to shred the text.
  const keyed = (mentions ?? []).filter((m) => m.key !== "");
  if (keyed.length === 0) return text;
  const re = mentionKeyRegex(keyed);
  if (text.replace(re, "").trim() === "") return "";
  const byKey = new Map(keyed.map((m) => [m.key, m]));
  const substituted = new Set<string>();
  const out = text.replace(re, (key: string, offset: number) => {
    if (substituted.has(key)) return key;
    substituted.add(key);
    const mention = byKey.get(key)!;
    const isThisBot = botOpenId !== null && mention.openId === botOpenId;
    const isLeading = text.slice(0, offset).trim() === "";
    return isThisBot && isLeading ? "" : `@${mention.name}`;
  });
  return out.trim();
}

/** The `image_key` of an image message's content JSON (null when unparseable). */
function imageKeyOfContent(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { image_key?: unknown };
    return typeof parsed.image_key === "string" && parsed.image_key !== ""
      ? parsed.image_key
      : null;
  } catch {
    return null;
  }
}

export class FeishuConnector implements MessagingChannelConnector {
  readonly channel = "feishu" as const;

  constructor(private readonly sdk: FeishuSdk) {}

  private credsOf(config: Record<string, unknown>): FeishuCredentials {
    return feishuConfigOf(config);
  }

  createClient(config: Record<string, unknown>): Promise<MessagingClient> {
    // FeishuApiClient already satisfies MessagingClient member for member.
    return this.sdk.createClient(this.credsOf(config));
  }

  async connect(
    config: Record<string, unknown>,
    handlers: MessagingConnectorHandlers,
  ): Promise<MessagingConnection> {
    const creds = this.credsOf(config);
    // One OpenAPI client per connection, shared by the identity lookup below and by every
    // inbound image's download — the event stream itself uses neither. It is built lazily so
    // that loading the SDK stays off the paths that never need it.
    let apiClient: Promise<FeishuApiClient> | null = null;
    const api = (): Promise<FeishuApiClient> => (apiClient ??= this.sdk.createClient(creds));
    /**
     * This bot's own open id: which mention in a group message is its own never changes while
     * the credentials do not, so one lookup per connection serves every inbound message.
     */
    let botOpenId: string | null = null;
    // Deliberately not awaited. connect() must resolve as soon as the connection is
    // constructed (see MessagingChannelConnector.connect): the bridge walks every enabled
    // binding on the server's boot path, so a lookup against an endpoint that accepts TCP and
    // never answers would keep the HTTP listener from ever binding. Telegram learns its own
    // identity the same way, from inside its poll loop. Until the answer lands, a mention of
    // this bot is named rather than dropped — the same degraded mode an app that cannot report
    // an identity at all already lives in.
    void api()
      .then((client) => client.botOpenId())
      .then((id) => {
        botOpenId = id;
      })
      .catch(() => {
        // `botOpenId` resolves null rather than throwing (see its doc); building the client
        // around it still can, and an unavailable identity is never a reason to refuse a
        // connection.
      });
    return this.sdk.connect(creds, {
      onMessage: (evt) => {
        // Only `text` messages carry text — a Feishu image message has no caption field of
        // its own; every other message type normalizes to null (the bridge answers those
        // with the not-supported notice).
        const raw = evt.messageType === "text" ? textOfContent(evt.content) : null;
        const imageKey = evt.messageType === "image" ? imageKeyOfContent(evt.content) : null;
        const images: MessagingInboundImage[] =
          imageKey === null
            ? []
            : [
                {
                  fetch: async (maxBytes) =>
                    (await api()).fetchMessageImage({
                      messageId: evt.messageId,
                      fileKey: imageKey,
                      maxBytes,
                    }),
                },
              ];
        return handlers.onMessage({
          chatId: evt.chatId,
          chatKind: evt.chatType === "p2p" ? "direct" : "group",
          messageId: evt.messageId,
          text: raw === null ? null : resolveFeishuMentions(raw, evt.mentions, botOpenId),
          ...(images.length > 0 ? { images } : {}),
          ...(evt.senderName !== undefined ? { senderName: evt.senderName } : {}),
        });
      },
      ...(handlers.onReady ? { onReady: handlers.onReady } : {}),
      ...(handlers.onError ? { onError: handlers.onError } : {}),
    });
  }
}
