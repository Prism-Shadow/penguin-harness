/**
 * Feishu (Lark) messaging connector — the first implementation of the
 * MessagingChannelConnector seam (telegram-connector.ts is the second). It owns
 * everything Feishu-specific: the config document's shape, the SDK adapter behind it
 * (injectable for tests — see feishu-sdk.ts), and the reduction of
 * `im.message.receive_v1` events to the bridge's normalized inbound shape (text extracted
 * from the content JSON; anything non-text reads as `text: null`).
 */
import type {
  MessagingChannelConnector,
  MessagingClient,
  MessagingConnection,
  MessagingConnectorHandlers,
} from "./connector.js";
import type { FeishuCredentials, FeishuSdk } from "./feishu-sdk.js";

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

  connect(
    config: Record<string, unknown>,
    handlers: MessagingConnectorHandlers,
  ): Promise<MessagingConnection> {
    return this.sdk.connect(this.credsOf(config), {
      onMessage: (evt) =>
        handlers.onMessage({
          chatId: evt.chatId,
          chatKind: evt.chatType === "p2p" ? "direct" : "group",
          messageId: evt.messageId,
          // Only `text` messages carry text; every other message type normalizes to null
          // (the bridge answers those with the text-only notice).
          text: evt.messageType === "text" ? textOfContent(evt.content) : null,
          ...(evt.senderName !== undefined ? { senderName: evt.senderName } : {}),
        }),
      ...(handlers.onReady ? { onReady: handlers.onReady } : {}),
      ...(handlers.onError ? { onError: handlers.onError } : {}),
    });
  }
}
