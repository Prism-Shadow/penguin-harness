/**
 * The Feishu (Lark) SDK seam: the narrow slice of `@larksuiteoapi/node-sdk` the bridge
 * uses, behind an injectable factory so unit tests substitute a fake and never open real
 * network. The real implementation loads the SDK lazily (dynamic import on first use):
 * the SDK is CJS and heavyweight, and a server with no bindings never pays for it.
 *
 * The SDK's own types are deliberately not imported — its bundled .d.ts is ~300k lines,
 * which would tax every typecheck for the handful of calls made here; the local interfaces
 * below are the contract, and the adapter casts the loaded module once.
 */

/** One credential set (the binding's stored values, or a test request's draft). */
export interface FeishuCredentials {
  appId: string;
  appSecret: string;
  /** Feishu open-platform domain, e.g. https://open.feishu.cn. */
  baseDomain: string;
}

/** One inbound `im.message.receive_v1` event, reduced to what the bridge consumes. */
export interface FeishuInboundEvent {
  chatId: string;
  /** `p2p` for a direct chat with the bot, `group` for a group chat. */
  chatType: string;
  messageId: string;
  /** Feishu message type (`text`, `image`, `sticker`, …); only `text` is processed. */
  messageType: string;
  /** Raw message content JSON (for `text`: `{"text":"..."}`). */
  content: string;
  /** Sender display name when the event carries one (the standard event does not). */
  senderName?: string;
}

/** OpenAPI half of the seam: credential probe + text sends. Every method throws on failure. */
export interface FeishuApiClient {
  /** Credential check: obtains a tenant access token (no scopes needed); throws with a readable reason. */
  checkCredentials(): Promise<void>;
  /** Sends a text message into a chat by chat_id. */
  sendText(chatId: string, text: string): Promise<void>;
  /** Replies a text message to a specific inbound message (threads correctly in group chats). */
  replyText(messageId: string, text: string): Promise<void>;
}

export interface FeishuEventHandlers {
  onMessage(evt: FeishuInboundEvent): void | Promise<void>;
  /** The long connection completed a handshake (fires again after an automatic reconnect). */
  onReady?(): void;
  /** The connection failed and the SDK gave up (or the initial connect failed). */
  onError?(err: unknown): void;
}

/** A live long-connection event stream; `close` ends it (idempotent). */
export interface FeishuConnection {
  close(): void;
}

/** Factory the bridge is built over: the production Lark adapter, or a test fake. */
export interface FeishuSdk {
  createClient(creds: FeishuCredentials): Promise<FeishuApiClient>;
  /**
   * Opens the long-connection event stream for one app. Resolves as soon as the client is
   * constructed and connecting — connection state arrives via the handlers (`onReady` /
   * `onError`), because the SDK reconnects on its own and a single promise cannot carry a
   * lifecycle.
   */
  connect(creds: FeishuCredentials, handlers: FeishuEventHandlers): Promise<FeishuConnection>;
}

// ---------------------------------------------------------------------------
// Production adapter over @larksuiteoapi/node-sdk
// ---------------------------------------------------------------------------

/** The slice of the SDK module the adapter instantiates (cast once at load). */
interface LarkModule {
  Client: new (params: {
    appId: string;
    appSecret: string;
    domain: string;
    loggerLevel: number;
  }) => LarkClient;
  WSClient: new (params: {
    appId: string;
    appSecret: string;
    domain: string;
    loggerLevel: number;
    autoReconnect: boolean;
    onReady?: () => void;
    onError?: (err: Error) => void;
  }) => LarkWsClient;
  EventDispatcher: new (params: Record<string, never>) => LarkEventDispatcher;
  LoggerLevel: { error: number };
}

/** `{code, msg}` response envelope shared by the SDK's OpenAPI calls (0 = success). */
interface LarkResponse {
  code?: number;
  msg?: string;
}

interface LarkClient {
  auth: {
    v3: {
      tenantAccessToken: {
        internal(payload: { data: { app_id: string; app_secret: string } }): Promise<LarkResponse>;
      };
    };
  };
  im: {
    v1: {
      message: {
        create(payload: {
          params: { receive_id_type: "chat_id" };
          data: { receive_id: string; content: string; msg_type: "text" };
        }): Promise<LarkResponse>;
        reply(payload: {
          path: { message_id: string };
          data: { content: string; msg_type: "text" };
        }): Promise<LarkResponse>;
      };
    };
  };
}

interface LarkWsClient {
  start(params: { eventDispatcher: LarkEventDispatcher }): Promise<void>;
  close(params?: { force?: boolean }): void;
}

interface LarkEventDispatcher {
  register(handlers: {
    "im.message.receive_v1": (data: {
      message: {
        message_id: string;
        chat_id: string;
        chat_type: string;
        message_type: string;
        content: string;
      };
    }) => Promise<void>;
  }): LarkEventDispatcher;
}

/** Readable failure text out of the SDK's throw shapes (axios errors carry the API body). */
function larkErrorText(err: unknown): string {
  const axios = err as { response?: { data?: { msg?: string; code?: number } }; message?: string };
  const body = axios.response?.data;
  if (body?.msg) return body.code !== undefined ? `${body.msg} (code ${body.code})` : body.msg;
  return err instanceof Error ? err.message : String(err);
}

/** Non-zero `{code}` envelopes come back as resolved responses; converge them to throws. */
function ensureOk(res: LarkResponse, what: string): void {
  if (res.code !== undefined && res.code !== 0) {
    throw new Error(`${what} failed: ${res.msg ?? "unknown error"} (code ${res.code})`);
  }
}

/** The production factory: lazy-loads the Lark SDK on first use. */
export function createLarkSdk(): FeishuSdk {
  let modPromise: Promise<LarkModule> | null = null;
  const load = (): Promise<LarkModule> => {
    modPromise ??= import("@larksuiteoapi/node-sdk").then(
      // CJS interop: depending on the loader the namespace or its `default` carries the exports.
      (m) => ((m as { default?: unknown }).default ?? m) as LarkModule,
    );
    return modPromise;
  };

  return {
    async createClient(creds: FeishuCredentials): Promise<FeishuApiClient> {
      const lark = await load();
      const client = new lark.Client({
        appId: creds.appId,
        appSecret: creds.appSecret,
        domain: creds.baseDomain,
        loggerLevel: lark.LoggerLevel.error,
      });
      return {
        async checkCredentials(): Promise<void> {
          let res: LarkResponse;
          try {
            res = await client.auth.v3.tenantAccessToken.internal({
              data: { app_id: creds.appId, app_secret: creds.appSecret },
            });
          } catch (err) {
            throw new Error(larkErrorText(err));
          }
          ensureOk(res, "Credential check");
        },
        async sendText(chatId: string, text: string): Promise<void> {
          let res: LarkResponse;
          try {
            res = await client.im.v1.message.create({
              params: { receive_id_type: "chat_id" },
              data: { receive_id: chatId, content: JSON.stringify({ text }), msg_type: "text" },
            });
          } catch (err) {
            throw new Error(larkErrorText(err));
          }
          ensureOk(res, "Message send");
        },
        async replyText(messageId: string, text: string): Promise<void> {
          let res: LarkResponse;
          try {
            res = await client.im.v1.message.reply({
              path: { message_id: messageId },
              data: { content: JSON.stringify({ text }), msg_type: "text" },
            });
          } catch (err) {
            throw new Error(larkErrorText(err));
          }
          ensureOk(res, "Message reply");
        },
      };
    },

    async connect(
      creds: FeishuCredentials,
      handlers: FeishuEventHandlers,
    ): Promise<FeishuConnection> {
      const lark = await load();
      const dispatcher = new lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data) => {
          await handlers.onMessage({
            chatId: data.message.chat_id,
            chatType: data.message.chat_type,
            messageId: data.message.message_id,
            messageType: data.message.message_type,
            content: data.message.content,
          });
        },
      });
      const ws = new lark.WSClient({
        appId: creds.appId,
        appSecret: creds.appSecret,
        domain: creds.baseDomain,
        loggerLevel: lark.LoggerLevel.error,
        autoReconnect: true,
        ...(handlers.onReady ? { onReady: handlers.onReady } : {}),
        ...(handlers.onError ? { onError: handlers.onError } : {}),
      });
      // start() settles only once the connect flow does; failures surface through onError
      // (and are re-routed here for the shapes that reject instead), so connect() itself
      // stays non-blocking.
      void ws.start({ eventDispatcher: dispatcher }).catch((err: unknown) => {
        handlers.onError?.(err);
      });
      return { close: () => ws.close() };
    },
  };
}
