/**
 * Feishu (Lark) messaging connector — the first implementation of the
 * MessagingChannelConnector seam (telegram-connector.ts is the second). It owns
 * everything Feishu-specific: the config document's shape, the SDK adapter behind it
 * (injectable for tests — see feishu-sdk.ts), and the reduction of
 * `im.message.receive_v1` events to the bridge's normalized inbound shape (text extracted
 * from the content JSON and its mention placeholders resolved — see resolveFeishuMentions;
 * anything non-text reads as `text: null`).
 */
import type {
  MessagingChannelConnector,
  MessagingClient,
  MessagingConnection,
  MessagingConnectorHandlers,
} from "./connector.js";
import type { FeishuCredentials, FeishuMention, FeishuSdk } from "./feishu-sdk.js";

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

/**
 * Mention placeholders, longest key first.
 *
 * Feishu numbers its placeholders `@_user_1`, `@_user_2`, … — so once a message mentions ten
 * people, `@_user_1` is a prefix of `@_user_10` and replacing in event order would corrupt
 * the longer key. Length order is the fix, and it is the only order that is safe for any
 * key set.
 */
function mentionsByKeyLength(mentions: readonly FeishuMention[]): FeishuMention[] {
  return [...mentions].sort((a, b) => b.key.length - a.key.length);
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
 * This bot's OWN mention is dropped instead of named, when its open id is known: the bridge
 * feeds inbound text to the model exactly as if it had been typed into the web composer, and
 * a leading `@PenguinHarness` would announce the channel the message came through. An
 * unknown id (see FeishuApiClient.botOpenId) only means the bot's mention is named like
 * everyone else's — the confusion the placeholder caused is gone either way.
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
  if (mentions === undefined || mentions.length === 0) return text;
  const ordered = mentionsByKeyLength(mentions);
  let bare = text;
  for (const m of ordered) bare = bare.split(m.key).join("");
  if (bare.trim() === "") return "";
  let out = text;
  for (const m of ordered) {
    const isThisBot = botOpenId !== null && m.openId === botOpenId;
    out = out.split(m.key).join(isThisBot ? "" : `@${m.name}`);
  }
  return out.trim();
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
    // One lookup per connection, held for its lifetime: which mention in a group message is
    // this bot's own never changes while the credentials do not, and every inbound message
    // needs the answer. `botOpenId` resolves null instead of throwing (see its doc), so a
    // bot that cannot report an identity still connects — mentions are then named rather
    // than dropped.
    const botOpenId = await (await this.sdk.createClient(creds)).botOpenId();
    return this.sdk.connect(creds, {
      onMessage: (evt) => {
        // Only `text` messages carry text; every other message type normalizes to null
        // (the bridge answers those with the text-only notice).
        const raw = evt.messageType === "text" ? textOfContent(evt.content) : null;
        return handlers.onMessage({
          chatId: evt.chatId,
          chatKind: evt.chatType === "p2p" ? "direct" : "group",
          messageId: evt.messageId,
          text: raw === null ? null : resolveFeishuMentions(raw, evt.mentions, botOpenId),
          ...(evt.senderName !== undefined ? { senderName: evt.senderName } : {}),
        });
      },
      ...(handlers.onReady ? { onReady: handlers.onReady } : {}),
      ...(handlers.onError ? { onError: handlers.onError } : {}),
    });
  }
}
