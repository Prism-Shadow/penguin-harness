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
import type { FeishuCard } from "./feishu-card.js";
import {
  MessagingMediaTooLargeError,
  MessagingPermissionError,
  collectUnderCap,
  sniffImageMime,
} from "./media.js";

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
  /**
   * Feishu message type (`text`, `image`, `file`, `sticker`, …). The connector reads the
   * three it delivers and normalizes everything else to a message with no content.
   */
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
   * Sends an interactive card into a chat by chat_id — how a reply's Markdown renders (see
   * feishu-card.ts). `msg_type: "interactive"` with the card JSON serialized into `content`;
   * a refusal throws FeishuApiError, so the caller can send the plain text instead.
   */
  sendCard(chatId: string, card: FeishuCard): Promise<void>;
  /**
   * Replies an interactive card to a specific inbound message. The reply endpoint takes the
   * same `msg_type` set as the send one, so a card threads in a group exactly as text does —
   * which is what keeps the group's one reply-to relation working with formatting on.
   */
  replyCard(messageId: string, card: FeishuCard): Promise<void>;
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
  /**
   * Downloads a non-image file carried by an inbound message (`file_key` is the content
   * JSON's own). The same endpoint the image download uses, asked for a different resource
   * `type` — which is the whole of the difference on the wire, and the reason both live
   * behind one adapter — and permissioned by the same scope, so an app refused one is
   * refused the other. Throws the same two shapes: `MessagingMediaTooLargeError` past
   * `maxBytes`, a plain Error carrying the API's own reason otherwise.
   *
   * Bytes only, no media type: the bytes go to disk under the sender's file name, and it is
   * the name's extension that says what they are (see MessagingInboundFile).
   */
  fetchMessageFile(args: { messageId: string; fileKey: string; maxBytes: number }): Promise<Buffer>;
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

/** The `msg_type` values this adapter sends (Feishu has many more; these are the four it uses). */
type FeishuMessageType = "text" | "image" | "file" | "interactive";

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
          data: { content: string; msg_type: FeishuMessageType };
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

/**
 * Feishu's `{code, msg, log_id}` refusal envelope, however it reached us. `log_id` is what
 * Feishu support asks for first, so it rides into the error record with the rest.
 */
interface LarkErrorEnvelope {
  code?: number;
  msg?: string;
  logId?: string;
}

/** The tenant-scope denial: the app is missing a permission, and the `msg` says which. */
const FEISHU_SCOPE_DENIED_CODE = 99991672;

/** Reads an envelope out of a value that may or may not be one (a parsed body, a JSON error). */
function envelopeOf(body: unknown): LarkErrorEnvelope | null {
  if (typeof body !== "object" || body === null) return null;
  const { code, msg, log_id: logId } = body as { code?: unknown; msg?: unknown; log_id?: unknown };
  if (typeof code !== "number" && typeof msg !== "string") return null;
  return {
    ...(typeof code === "number" ? { code } : {}),
    ...(typeof msg === "string" ? { msg } : {}),
    ...(typeof logId === "string" ? { logId } : {}),
  };
}

/** The envelope carried by an SDK throw (axios puts the parsed API body on `response.data`). */
function larkErrorEnvelope(err: unknown): LarkErrorEnvelope | null {
  return envelopeOf((err as { response?: { data?: unknown } }).response?.data);
}

/** Readable text for a refusal: Feishu's own sentence when there is one, the SDK's otherwise. */
function envelopeText(envelope: LarkErrorEnvelope | null, err: unknown): string {
  const fallback = err instanceof Error ? err.message : String(err);
  if (envelope?.msg === undefined || envelope.msg === "") return fallback;
  const parts = [
    ...(envelope.code !== undefined ? [`code ${envelope.code}`] : []),
    ...(envelope.logId !== undefined ? [`log_id ${envelope.logId}`] : []),
  ];
  return parts.length > 0 ? `${envelope.msg} (${parts.join(", ")})` : envelope.msg;
}

/** How much of a refusal's `msg` is scanned for the grant link, and how long a link may be. */
const SCOPE_MSG_MAX = 2000;
const GRANT_URL_MAX = 500;

/**
 * The actionable half of a tenant-scope denial: which permissions would satisfy the call,
 * and the console link that grants them.
 *
 * Feishu writes both into `msg` — "One of the following scopes is required:
 * [im:resource:upload, im:resource]" followed by a per-app `…/app/<app-id>/auth?q=…` URL.
 * The link is app-specific and already correct, so it is extracted rather than rebuilt.
 * The prose around them is localized and must never be matched on: the CODE is the test.
 */
function scopeDenialDetail(msg: string): { scopes: string[]; grantUrl: string | null } {
  const text = msg.slice(0, SCOPE_MSG_MAX);
  const bracketed = /\[([^\]]+)\]/.exec(text);
  const scopes = (bracketed?.[1] ?? "")
    .split(",")
    .map((scope) => scope.trim())
    // A scope name is an ASCII colon-separated token; anything else is prose that happened
    // to sit in brackets, and naming it would send the user looking for a permission that
    // does not exist.
    .filter((scope) => /^[a-z][a-z0-9_.:-]*$/i.test(scope));
  // Only an https link, and only up to the first whitespace or CJK punctuation — the
  // sentence continues in Chinese right after the URL in Feishu's own wording.
  const url = /https:\/\/[^\s，。、）)]+/.exec(text)?.[0] ?? null;
  return { scopes, grantUrl: url !== null && url.length <= GRANT_URL_MAX ? url : null };
}

/**
 * A call Feishu itself REFUSED, carrying the `{code}` it refused with.
 *
 * Its own class for the reason telegram-api's TelegramApiError is one: a refusal and a
 * request that never completed are the same outcome and opposite facts. Feishu answered, so
 * nothing was delivered and the same message may safely be sent again in another form —
 * which is what the card-to-text fallback does. A timeout or a reset carries no code, stays
 * a plain Error, and must never be retried: it may well have been delivered already, and a
 * retry would put the reply in the chat twice.
 */
export class FeishuApiError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
  ) {
    super(message);
    this.name = "FeishuApiError";
  }
}

/**
 * The error a refused call throws: a permission denial when Feishu said so by CODE, a plain
 * failure otherwise. Only the scope names and the console link travel with the first — the
 * SDK's own error object carries the request config, which is where credentials live.
 */
function larkFailure(envelope: LarkErrorEnvelope | null, err: unknown, what?: string): Error {
  const detail = envelopeText(envelope, err);
  // The operation stays in front of the API's own sentence: an error record that reads only
  // "invalid request" does not say which call made it.
  const text = what === undefined ? detail : `${what} failed: ${detail}`;
  if (envelope?.code === FEISHU_SCOPE_DENIED_CODE && envelope.msg !== undefined) {
    const { scopes, grantUrl } = scopeDenialDetail(envelope.msg);
    if (scopes.length > 0) return new MessagingPermissionError(scopes, grantUrl, text);
  }
  // An envelope with a code is Feishu's own refusal; anything else never reached it.
  if (envelope?.code !== undefined) return new FeishuApiError(text, envelope.code);
  return new Error(text);
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
 * The refusal envelope of a request made with `responseType: "stream"` — the resource
 * download.
 *
 * That response type applies to the FAILURE as well: on a refusal the SDK hands back an
 * error whose `response.data` is the response STREAM, unread, not a parsed `{code,msg}`
 * envelope. Read straight off the error it yields nothing, and the report is "Request
 * failed with status code 400" — the one thing the user cannot act on, hiding the one they
 * can. The body is small and already in hand, so it is drained and parsed here.
 */
async function larkStreamErrorEnvelope(err: unknown): Promise<LarkErrorEnvelope | null> {
  const body = (err as { response?: { data?: unknown } }).response?.data;
  const direct = envelopeOf(body);
  if (direct !== null) return direct;
  if (!isAsyncIterable(body)) return null;
  try {
    const raw = await collectUnderCap(body, ERROR_BODY_MAX_BYTES, "The error body");
    return envelopeOf(JSON.parse(raw.toString("utf8")));
  } catch {
    // Not a JSON envelope (an HTML error page, a truncated body, a stream someone else
    // already consumed): the generic text is still better than throwing a second error out
    // of the error path.
    return null;
  }
}

/**
 * Non-zero `{code}` envelopes come back as RESOLVED responses; converge them to throws, and
 * through the same reading as a rejection so a scope denial is one wherever it arrives.
 */
function ensureOk(res: LarkResponse, what: string): void {
  if (res.code === undefined || res.code === 0) return;
  throw larkFailure(envelopeOf(res), new Error("unknown error"), what);
}

/**
 * Per-call deadline for everything this adapter puts on the wire.
 *
 * The SDK's default transport is a bare `axios.create()` with NO timeout, so a request the
 * API accepts and never answers waits forever. That is not a slow send: every outbound
 * message of a Session goes out on one serial chain (MessagingBridge's `sendChain`), so one
 * request that never settles parks every later reply, approval notice and file for that
 * Session — silently, with no error record and no status change — until the binding is
 * toggled or the server restarts. The same stall on the inbound side parks the message with
 * neither delivery nor refusal. Telegram has had a deadline on both directions from the
 * start (see telegram-api's CALL_TIMEOUT_MS / TRANSFER_TIMEOUT_MS); this is Feishu's.
 *
 * One number for both kinds of call, unlike Telegram's two: the uploads and the resource
 * download move at most 30MB, and a chat send that has not answered in a minute is not
 * coming back.
 */
const FEISHU_CALL_TIMEOUT_MS = 60_000;

/**
 * `promise` with a deadline. The underlying request is NOT cancelled — the SDK exposes no
 * signal — so this frees the CALLER, not the socket: the send chain moves on and the
 * abandoned request is left to the runtime. That is the whole point; a leaked socket costs
 * one connection, a wedged chain costs the Session.
 */
function withDeadline<T>(promise: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  // The abandoned promise still needs a handler, or its later rejection is an unhandled one.
  promise.catch(() => {});
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, deadline]).finally(() => {
    clearTimeout(timer);
  });
}

/** The production factory: lazy-loads the Lark SDK on first use. */
/**
 * `httpInstance` is the SDK's own injection point (`params.httpInstance`, used by every
 * call including the tenant-token fetch). Tests pass a stub that stands exactly where axios
 * stands, so the SDK's URL building, `:path` filling, param serialization and response
 * unwrapping all run for real — the layer a hand-written fake of this module's own
 * interface cannot reach, and where both of this adapter's protocol bugs lived. Production
 * passes nothing.
 *
 * `timeoutMs` overrides FEISHU_CALL_TIMEOUT_MS. Tests only — a deadline test cannot wait a
 * minute, and production has no reason to want a different one.
 */
export interface LarkSdkOpts {
  httpInstance?: unknown;
  timeoutMs?: number;
}

export function createLarkSdk(opts: LarkSdkOpts = {}): FeishuSdk {
  const timeoutMs = opts.timeoutMs ?? FEISHU_CALL_TIMEOUT_MS;
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
      /** Every call this client makes goes out under the deadline — see withDeadline. */
      const deadline = <T>(call: Promise<T>, what: string): Promise<T> =>
        withDeadline(call, timeoutMs, what);
      /**
       * One `im.v1.messageResource.get`, shared by both inbound downloads: the resource
       * `type` differs, nothing else does. The stream is handed back UNREAD so the caller
       * applies its own cap while the bytes arrive — reading here would put the whole file
       * in memory before anyone could refuse it.
       *
       * The endpoint is scoped to the message, so a bot can only read resources from
       * conversations it is in; there is no key-only fetch to abuse.
       */
      const fetchResource = async (args: {
        messageId: string;
        fileKey: string;
        type: "image" | "file";
        what: string;
      }): Promise<LarkStreamResponse> => {
        try {
          return await deadline(
            client.im.v1.messageResource.get({
              path: { message_id: args.messageId, file_key: args.fileKey },
              params: { type: args.type },
            }),
            args.what,
          );
        } catch (err) {
          throw larkFailure(await larkStreamErrorEnvelope(err), err);
        }
      };
      /** One `im.v1.message.create`, shared by every message kind: the content JSON differs, nothing else does. */
      const sendContent = async (
        chatId: string,
        msgType: FeishuMessageType,
        content: unknown,
      ): Promise<void> => {
        let res: LarkResponse;
        try {
          res = await deadline(
            client.im.v1.message.create({
              params: { receive_id_type: "chat_id" },
              data: { receive_id: chatId, content: JSON.stringify(content), msg_type: msgType },
            }),
            "Message send",
          );
        } catch (err) {
          throw larkFailure(larkErrorEnvelope(err), err);
        }
        ensureOk(res, "Message send");
      };
      /** One `im.v1.message.reply`, the threading twin of sendContent. */
      const replyContent = async (
        messageId: string,
        msgType: FeishuMessageType,
        content: unknown,
      ): Promise<void> => {
        let res: LarkResponse;
        try {
          res = await deadline(
            client.im.v1.message.reply({
              path: { message_id: messageId },
              data: { content: JSON.stringify(content), msg_type: msgType },
            }),
            "Message reply",
          );
        } catch (err) {
          throw larkFailure(larkErrorEnvelope(err), err);
        }
        ensureOk(res, "Message reply");
      };

      return {
        async checkCredentials(): Promise<null> {
          let res: LarkResponse;
          try {
            res = await deadline(
              client.auth.v3.tenantAccessToken.internal({
                data: { app_id: creds.appId, app_secret: creds.appSecret },
              }),
              "Credential check",
            );
          } catch (err) {
            throw larkFailure(larkErrorEnvelope(err), err);
          }
          ensureOk(res, "Credential check");
          return null;
        },
        sendText(chatId: string, text: string): Promise<void> {
          return sendContent(chatId, "text", { text });
        },
        sendCard(chatId: string, card: FeishuCard): Promise<void> {
          return sendContent(chatId, "interactive", card);
        },
        replyText(messageId: string, text: string): Promise<void> {
          return replyContent(messageId, "text", { text });
        },
        replyCard(messageId: string, card: FeishuCard): Promise<void> {
          return replyContent(messageId, "interactive", card);
        },
        async botOpenId(): Promise<string | null> {
          // Best effort by contract (see FeishuApiClient.botOpenId): every failure shape —
          // a thrown request, a non-zero envelope, a body without the field — answers
          // "unknown" so a connection is never refused over it.
          try {
            const res = await deadline(
              client.request({ url: "/open-apis/bot/v3/info", method: "GET" }),
              "Bot identity lookup",
            );
            if (res.code !== undefined && res.code !== 0) return null;
            return res.bot?.open_id ?? null;
          } catch {
            return null;
          }
        },
        async fetchMessageImage({ messageId, fileKey, maxBytes }): Promise<FeishuImageData> {
          const res = await fetchResource({
            messageId,
            fileKey,
            type: "image",
            what: "Image download",
          });
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
        async fetchMessageFile({ messageId, fileKey, maxBytes }): Promise<Buffer> {
          const res = await fetchResource({
            messageId,
            fileKey,
            type: "file",
            what: "File download",
          });
          return collectUnderCap(res.getReadableStream(), maxBytes, "The file");
        },
        async sendImage(chatId: string, file: FeishuOutboundFile): Promise<void> {
          // Two steps, as Feishu requires: the bytes are uploaded on their own and the
          // message carries only the key they were stored under.
          let uploaded: { image_key?: string } | null;
          try {
            uploaded = await deadline(
              client.im.v1.image.create({ data: { image_type: "message", image: file.data } }),
              "Image upload",
            );
          } catch (err) {
            throw larkFailure(larkErrorEnvelope(err), err);
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
            uploaded = await deadline(
              client.im.v1.file.create({
                data: {
                  file_type: feishuFileTypeOf(file.fileName),
                  file_name: file.fileName,
                  file: file.data,
                },
              }),
              "File upload",
            );
          } catch (err) {
            throw larkFailure(larkErrorEnvelope(err), err);
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
