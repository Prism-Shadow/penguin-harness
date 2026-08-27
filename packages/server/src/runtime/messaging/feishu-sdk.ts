/**
 * The Feishu (Lark) SDK seam: the narrow slice of `@larksuiteoapi/node-sdk` the Feishu
 * connector uses, behind an injectable factory so unit tests substitute a fake and never
 * open real network. The real implementation loads the SDK lazily (dynamic import on
 * first use): the SDK is CJS and heavyweight, and a server with no Feishu bindings never
 * pays for it.
 *
 * The SDK's own types are deliberately not imported — its bundled .d.ts is ~300k lines,
 * which would tax every typecheck for the handful of calls made here; the local interfaces
 * below are the contract, and the adapter casts the loaded module once.
 */
import { MessagingMediaTooLargeError, collectUnderCap, sniffImageMime } from "./media.js";

/** One credential set (a binding's stored values, or a test request's draft). */
export interface FeishuCredentials {
  appId: string;
  appSecret: string;
  /** Feishu open-platform domain, e.g. https://open.feishu.cn. */
  baseDomain: string;
}

/**
 * One `@` in a message, as Feishu reports it: the event's `content` JSON carries only a
 * placeholder (`@_user_1`) where the mention stands, and this array says what each
 * placeholder refers to. Without it the text is unreadable — see the connector's
 * resolveFeishuMentions.
 */
export interface FeishuMention {
  /** The literal placeholder inside the content JSON's `text`, e.g. `@_user_1`. */
  key: string;
  /** Display name of whoever was mentioned (a bot's is its own name). */
  name: string;
  /** Open id of whoever was mentioned; absent when the event carries no id for them. */
  openId?: string;
}

/** One inbound `im.message.receive_v1` event, reduced to what the connector consumes. */
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
  /** Everyone `@`-ed in this message, in the order Feishu lists them; absent when nobody was. */
  mentions?: FeishuMention[];
}

/** The bytes of one downloaded resource, with the MIME type the caller needs for a data URL. */
export interface FeishuImageData {
  data: Buffer;
  mimeType: string;
}

/**
 * One file on its way into a chat. Structurally the connector seam's MessagingOutboundFile
 * — declared here rather than imported for the same reason FeishuApiClient mirrors
 * MessagingClient member for member: this module is the layer below the seam and stays
 * free of it, and the connector's assignment is what proves the two agree.
 */
export interface FeishuOutboundFile {
  fileName: string;
  data: Buffer;
}

/** OpenAPI half of the seam: credential probe, text sends, media in both directions. Every method throws on failure. */
export interface FeishuApiClient {
  /**
   * Credential check: obtains a tenant access token (no scopes needed); throws with a
   * readable reason. Resolves null — the token exchange yields no account label to
   * surface (`MessagingClient.checkCredentials`' optional payload).
   */
  checkCredentials(): Promise<null>;
  /** Sends a text message into a chat by chat_id. */
  sendText(chatId: string, text: string): Promise<void>;
  /** Replies a text message to a specific inbound message (threads correctly in group chats). */
  replyText(messageId: string, text: string): Promise<void>;
  /**
   * This app's own bot open id, so a group message's mention of THIS bot can be told apart
   * from a mention of anyone else (the ids are the only thing that distinguishes them —
   * two accounts may share a display name).
   *
   * Resolves null rather than throwing when the app cannot report one: the bot capability
   * may be off, or the call may simply fail, and neither is a reason to refuse a
   * connection. A null answer degrades mention handling, it does not break it.
   */
  botOpenId(): Promise<string | null>;
  /**
   * Downloads an image carried by an inbound message (`file_key` is the content JSON's
   * `image_key`). Throws `MessagingMediaTooLargeError` past `maxBytes`, and a plain Error
   * carrying the API's own reason otherwise. The resource endpoint is scoped to the
   * message, so a bot can only read images from conversations it is in — there is no
   * key-only fetch to abuse.
   *
   * It is also permissioned SEPARATELY from receiving messages: an app that happily
   * delivers `im.message.receive_v1` events still gets a refusal here until the resource
   * read scope is granted to it. Nothing in this process can fix that, which is exactly why
   * the API's reason has to survive all the way to the chat.
   */
  fetchMessageImage(args: {
    messageId: string;
    fileKey: string;
    maxBytes: number;
  }): Promise<FeishuImageData>;
  /** Uploads a picture (`im.v1.image.create`) and sends the resulting key as an `image` message. */
  sendImage(chatId: string, file: FeishuOutboundFile): Promise<void>;
  /** Uploads a file (`im.v1.file.create`) and sends the resulting key as a `file` message. */
  sendFile(chatId: string, file: FeishuOutboundFile): Promise<void>;
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

/** Factory the Feishu connector is built over: the production Lark adapter, or a test fake. */
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
    /** Test seam: the SDK's `params.httpInstance`, which every call (token fetch included) goes through. */
    httpInstance?: unknown;
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

/** The `msg_type` values this adapter sends (Feishu has many more; these are the three it uses). */
type FeishuMessageType = "text" | "image" | "file";

/**
 * Feishu's upload categories. `stream` is the general one — the rest exist because the
 * client renders a preview for them, so mapping a `.pdf` or a `.xlsx` onto its own category
 * is what makes it open in the chat instead of only downloading.
 */
type FeishuFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";

const FEISHU_FILE_TYPE_BY_EXT: Readonly<Record<string, FeishuFileType>> = {
  opus: "opus",
  mp4: "mp4",
  pdf: "pdf",
  doc: "doc",
  docx: "doc",
  xls: "xls",
  xlsx: "xls",
  ppt: "ppt",
  pptx: "ppt",
};

/** The upload category for a file name; anything unrecognized uploads as a plain stream. */
function feishuFileTypeOf(fileName: string): FeishuFileType {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "stream";
  return FEISHU_FILE_TYPE_BY_EXT[fileName.slice(dot + 1).toLowerCase()] ?? "stream";
}

/**
 * The binary-download shape (`im.v1.messageResource.get`): the SDK hands back a stream
 * wrapper, not a `{code,msg}` envelope, because the endpoint answers with the file itself.
 * Typed as an async iterable of chunks rather than as node:stream's `Readable` — that is
 * all the adapter consumes, and it keeps the capped read (collectUnderCap) channel-neutral.
 */
interface LarkStreamResponse {
  getReadableStream(): AsyncIterable<Uint8Array>;
  headers?: Record<string, unknown>;
}

interface LarkClient {
  /**
   * The SDK's generic call, for endpoints its typed surface does not cover. Used for
   * `/open-apis/bot/v3/info`, which has no typed member here (the SDK's own internals reach
   * it the same way).
   */
  request(args: {
    url: string;
    method: string;
  }): Promise<LarkResponse & { bot?: { open_id?: string } }>;
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
          data: { receive_id: string; content: string; msg_type: FeishuMessageType };
        }): Promise<LarkResponse>;
        reply(payload: {
          path: { message_id: string };
          data: { content: string; msg_type: "text" };
        }): Promise<LarkResponse>;
      };
      messageResource: {
        get(payload: {
          path: { message_id: string; file_key: string };
          params: { type: string };
        }): Promise<LarkStreamResponse>;
      };
      image: {
        create(payload: {
          data: { image_type: "message"; image: Buffer };
        }): Promise<{ image_key?: string } | null>;
      };
      file: {
        create(payload: {
          data: { file_type: FeishuFileType; file_name: string; file: Buffer };
        }): Promise<{ file_key?: string } | null>;
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
        mentions?: {
          key: string;
          name: string;
          id?: { open_id?: string };
        }[];
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

/**
 * How much of a failed download's body is read back to find the API's reason. A Feishu
 * error envelope is a few hundred bytes; the bound is there because the body is untrusted
 * and the process must not be made to hold whatever arrives.
 */
const ERROR_BODY_MAX_BYTES = 64 * 1024;

/** Whether a value is something `for await` can read (the error body of a streamed request). */
function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === "function"
  );
}

/**
 * Readable failure text for a request made with `responseType: "stream"` — the resource
 * download.
 *
 * That response type applies to the FAILURE as well: on a refusal the SDK hands back an
 * error whose `response.data` is a stream, not a parsed `{code,msg}` envelope, so
 * `larkErrorText` finds nothing there and reports "Request failed with status code 403".
 * That sentence names the one thing the user cannot act on and hides the one they can —
 * "app has no permission to access resource" is a scope to go and grant. The body is small
 * and already in hand, so it is read and parsed here.
 */
async function larkStreamErrorText(err: unknown): Promise<string> {
  const body = (err as { response?: { data?: unknown } }).response?.data;
  if (isAsyncIterable(body)) {
    try {
      const raw = await collectUnderCap(body, ERROR_BODY_MAX_BYTES, "The error body");
      const parsed = JSON.parse(raw.toString("utf8")) as { code?: unknown; msg?: unknown };
      if (typeof parsed.msg === "string" && parsed.msg !== "") {
        return typeof parsed.code === "number" ? `${parsed.msg} (code ${parsed.code})` : parsed.msg;
      }
    } catch {
      // Not a JSON envelope (an HTML error page, a truncated body): the generic text below
      // is still better than throwing a second error out of the error path.
    }
  }
  return larkErrorText(err);
}

/** Non-zero `{code}` envelopes come back as resolved responses; converge them to throws. */
function ensureOk(res: LarkResponse, what: string): void {
  if (res.code !== undefined && res.code !== 0) {
    throw new Error(`${what} failed: ${res.msg ?? "unknown error"} (code ${res.code})`);
  }
}

/** The production factory: lazy-loads the Lark SDK on first use. */
/**
 * `httpInstance` is the SDK's own injection point (`params.httpInstance`, used by every
 * call including the tenant-token fetch). Tests pass a stub that stands exactly where axios
 * stands, so the SDK's URL building, `:path` filling, param serialization and response
 * unwrapping all run for real — the layer a hand-written fake of this module's own
 * interface cannot reach, and where both of this adapter's protocol bugs lived. Production
 * passes nothing.
 */
export interface LarkSdkOpts {
  httpInstance?: unknown;
}

export function createLarkSdk(opts: LarkSdkOpts = {}): FeishuSdk {
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
        ...(opts.httpInstance !== undefined ? { httpInstance: opts.httpInstance } : {}),
      });
      /** One `im.v1.message.create`, shared by every message kind: the content JSON differs, nothing else does. */
      const sendContent = async (
        chatId: string,
        msgType: FeishuMessageType,
        content: Record<string, string>,
      ): Promise<void> => {
        let res: LarkResponse;
        try {
          res = await client.im.v1.message.create({
            params: { receive_id_type: "chat_id" },
            data: { receive_id: chatId, content: JSON.stringify(content), msg_type: msgType },
          });
        } catch (err) {
          throw new Error(larkErrorText(err));
        }
        ensureOk(res, "Message send");
      };

      return {
        async checkCredentials(): Promise<null> {
          let res: LarkResponse;
          try {
            res = await client.auth.v3.tenantAccessToken.internal({
              data: { app_id: creds.appId, app_secret: creds.appSecret },
            });
          } catch (err) {
            throw new Error(larkErrorText(err));
          }
          ensureOk(res, "Credential check");
          return null;
        },
        sendText(chatId: string, text: string): Promise<void> {
          return sendContent(chatId, "text", { text });
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
        async botOpenId(): Promise<string | null> {
          // Best effort by contract (see FeishuApiClient.botOpenId): every failure shape —
          // a thrown request, a non-zero envelope, a body without the field — answers
          // "unknown" so a connection is never refused over it.
          try {
            const res = await client.request({ url: "/open-apis/bot/v3/info", method: "GET" });
            if (res.code !== undefined && res.code !== 0) return null;
            return res.bot?.open_id ?? null;
          } catch {
            return null;
          }
        },
        async fetchMessageImage({ messageId, fileKey, maxBytes }): Promise<FeishuImageData> {
          let res: LarkStreamResponse;
          try {
            res = await client.im.v1.messageResource.get({
              path: { message_id: messageId, file_key: fileKey },
              params: { type: "image" },
            });
          } catch (err) {
            throw new Error(await larkStreamErrorText(err));
          }
          const data = await collectUnderCap(res.getReadableStream(), maxBytes, "The image");
          // The response header states what the SENDER uploaded, which is a claim; the
          // magic bytes are the file. PNG is the last resort — a data URL needs some type,
          // and every provider that takes images at all takes that one.
          const declared = res.headers?.["content-type"];
          const headerType =
            typeof declared === "string" && declared.startsWith("image/")
              ? declared.split(";")[0]!.trim()
              : null;
          return { data, mimeType: sniffImageMime(data) ?? headerType ?? "image/png" };
        },
        async sendImage(chatId: string, file: FeishuOutboundFile): Promise<void> {
          // Two steps, as Feishu requires: the bytes are uploaded on their own and the
          // message carries only the key they were stored under.
          let uploaded: { image_key?: string } | null;
          try {
            uploaded = await client.im.v1.image.create({
              data: { image_type: "message", image: file.data },
            });
          } catch (err) {
            throw new Error(larkErrorText(err));
          }
          // The upload endpoints resolve to their `data` object, so a refusal arrives as a
          // missing key rather than as a non-zero `{code}` this adapter could report.
          const imageKey = uploaded?.image_key;
          if (imageKey === undefined || imageKey === "") {
            throw new Error(`Image upload failed: ${file.fileName} returned no image_key`);
          }
          await sendContent(chatId, "image", { image_key: imageKey });
        },
        async sendFile(chatId: string, file: FeishuOutboundFile): Promise<void> {
          let uploaded: { file_key?: string } | null;
          try {
            uploaded = await client.im.v1.file.create({
              data: {
                file_type: feishuFileTypeOf(file.fileName),
                file_name: file.fileName,
                file: file.data,
              },
            });
          } catch (err) {
            throw new Error(larkErrorText(err));
          }
          const fileKey = uploaded?.file_key;
          if (fileKey === undefined || fileKey === "") {
            throw new Error(`File upload failed: ${file.fileName} returned no file_key`);
          }
          await sendContent(chatId, "file", { file_key: fileKey });
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
          const mentions = data.message.mentions?.map((m) => ({
            key: m.key,
            name: m.name,
            ...(m.id?.open_id !== undefined ? { openId: m.id.open_id } : {}),
          }));
          await handlers.onMessage({
            chatId: data.message.chat_id,
            chatType: data.message.chat_type,
            messageId: data.message.message_id,
            messageType: data.message.message_type,
            content: data.message.content,
            ...(mentions !== undefined ? { mentions } : {}),
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
