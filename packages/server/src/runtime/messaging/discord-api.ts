/**
 * The Discord bot seam: the REST calls the connector makes (`GET /users/@me` as the
 * credential probe, the channel message send, the two multipart uploads, the attachment
 * download) and the Gateway WebSocket that delivers inbound messages, behind an injectable
 * transport so unit tests substitute a fake and never open a socket to Discord. No SDK is
 * taken: the REST surface this product uses is four endpoints of plain HTTPS, and the
 * Gateway is the same opcode numbering the QQ gateway already speaks (QQ's is a copy of
 * this one), so the session below is qq-api.ts's shape with Discord's close codes and
 * Discord's resume rule.
 *
 * Wire types below mirror the platform's JSON verbatim (snake_case): the transport does not
 * reshape payloads, so a test fake constructs exactly what the real API returns.
 *
 * Three properties of this platform shape the seam:
 *
 *   1. THE CREDENTIAL IS THE BOT TOKEN, AND IT NAMES THE BOT. Every REST call carries
 *      `Authorization: Bot <token>`, and the Gateway identifies with the same token. Its
 *      first dot-separated segment is the bot's user id in base64 (see
 *      discord-connector.ts discordBotIdOf), so — as on Telegram — the account identity
 *      falls out of the credential without a network call.
 *   2. THE GATEWAY IS THE ONLY WAY IN FOR A LOCAL SERVER. Discord's other inbound path is
 *      the Interactions webhook, which needs a public HTTPS endpoint and covers slash
 *      commands rather than ordinary messages. So this seam opens the Gateway, identifies
 *      with the two message intents, heartbeats, and resumes — no public URL anywhere.
 *   3. MESSAGE CONTENT IS PRIVILEGED. Without the `MESSAGE_CONTENT` intent — which a bot's
 *      owner must switch on in the developer portal, and which Discord refuses at identify
 *      (close 4014) for any bot that has not — a guild message's `content` and
 *      `attachments` arrive EMPTY, except for direct messages and messages that @-mention
 *      the bot, which always carry them. This connector deliberately does not ask for the
 *      intent: it reads direct messages and @-mentions only (the same rule QQ's group
 *      events impose), which works for every bot with no portal setting to get wrong.
 */
import { FormData, WebSocket, fetch as undiciFetch } from "undici";
import { MessagingMediaTooLargeError, collectUnderCap } from "./media.js";
import { MessagingConnectionClosedError } from "./qq-api.js";

/** Discord REST host and API version. Deliberately not configurable: bindings carry only the token. */
export const DISCORD_API_BASE = "https://discord.com/api/v10";

/** The query the Gateway URL is opened with: this API version, JSON frames. */
const GATEWAY_QUERY = "v=10&encoding=json";

/**
 * The intents this bot subscribes: `GUILD_MESSAGES` (1 << 9) for messages in server
 * channels and threads, `DIRECT_MESSAGES` (1 << 12) for direct chats with the bot. Both are
 * unprivileged. `MESSAGE_CONTENT` (1 << 15) is deliberately absent — see the module doc.
 */
export const DISCORD_INTENTS = (1 << 9) | (1 << 12);

/**
 * The hard ceiling on one message's `content`, in UTF-16 units — what a JS string length
 * measures. Past it the send is refused (50035 Invalid Form Body), so the connector chunks
 * under it (see DISCORD_TEXT_CHUNK_CHARS in discord-connector.ts).
 */
export const DISCORD_MAX_CONTENT_CHARS = 2000;

/** One credential set (a binding's stored token, or a test request's draft). */
export interface DiscordCredentials {
  /** The bot token as the developer portal issues it, without the `Bot ` prefix. */
  botToken: string;
}

/** `GET /users/@me` result — the slice of the User object the connector consumes. */
export interface DiscordBotUser {
  id: string;
  username: string;
  /** The display name, when one is set; `username` is the handle. */
  global_name?: string | null;
}

/** `GET /gateway/bot` result: the WebSocket URL to connect to. */
export interface DiscordGatewayInfo {
  url: string;
}

/** One attachment on an inbound message, as the platform describes it. */
export interface DiscordAttachment {
  id: string;
  /** The sender's own file name, extension included. */
  filename: string;
  /** Declared size in bytes; the capped read is what actually holds. */
  size: number;
  /** A signed CDN URL, valid for a while after the event; the connector fetches it lazily. */
  url: string;
  /** The platform's guess at the media type, when it made one. */
  content_type?: string;
  /** Present on a voice message's recording, and on nothing else — what tells one apart. */
  duration_secs?: number;
}

/**
 * The slice of a `MESSAGE_CREATE` dispatch the connector consumes. A thread is a channel of
 * its own on this platform, so `channel_id` alone routes a reply back to where the message
 * was written — no Telegram-style topic packing is needed.
 */
export interface DiscordMessage {
  id: string;
  channel_id: string;
  /** Absent in a direct message; present for every server channel and thread. */
  guild_id?: string;
  author: {
    id: string;
    username: string;
    global_name?: string | null;
    /** True for any bot's message, this bot's own included. */
    bot?: boolean;
  };
  /** Empty for a guild message that neither mentions the bot nor was sent to it (see the module doc). */
  content: string;
  attachments?: DiscordAttachment[];
  /** The users this message @-mentions; the connector looks for its own bot here. */
  mentions?: Array<{ id: string }>;
  /** 0 = DEFAULT, 19 = REPLY; anything else is a system message (join, pin, boost, …). */
  type: number;
}

/** One outbound text send. */
export interface DiscordSendArgs {
  channelId: string;
  content: string;
  /** Threads the message under an inbound one (the chat renders a quote header). */
  replyToMessageId?: string;
}

/** One outbound upload: the bytes plus the name the chat should show. */
export interface DiscordUploadArgs {
  channelId: string;
  fileName: string;
  data: Buffer;
}

/** REST half of the seam, bound to one token. Every method throws on failure with a readable reason. */
export interface DiscordBotClient {
  /** Credential probe: resolves the bot's own account (the test endpoint surfaces its handle). */
  getMe(): Promise<DiscordBotUser>;
  /** Sends a text message into a channel, optionally as a reply. */
  sendMessage(args: DiscordSendArgs): Promise<void>;
  /** Uploads one file as a message attachment; a picture arrives inline, anything else as a download. */
  sendFile(args: DiscordUploadArgs): Promise<void>;
  /**
   * Downloads an attachment by its CDN URL, refusing anything past `maxBytes` with
   * MessagingMediaTooLargeError. `what` names the transfer in that refusal.
   */
  fetchAttachment(args: { url: string; maxBytes: number; what?: string }): Promise<Buffer>;
}

export interface DiscordGatewayHandlers {
  onMessage(msg: DiscordMessage): void | Promise<void>;
  /** The gateway completed a handshake (fires again after an automatic reconnect). */
  onReady?(): void;
  /** The gateway failed; reported once per outage, as the QQ gateway does. */
  onError?(err: unknown): void;
}

/** A live gateway session; `close` ends it and stops reconnecting (idempotent). */
export interface DiscordGatewayConnection {
  close(): void;
}

/** Factory the Discord connector is built over: the production adapter, or a test fake. */
export interface DiscordTransport {
  createClient(creds: DiscordCredentials): DiscordBotClient;
  /**
   * Opens the gateway for one bot. Resolves as soon as the session is constructed and
   * connecting — lifecycle arrives via the handlers (`onReady` / `onError`), because the
   * adapter reconnects on its own and a single promise cannot carry a lifecycle.
   */
  openGateway(
    creds: DiscordCredentials,
    handlers: DiscordGatewayHandlers,
  ): Promise<DiscordGatewayConnection>;
}

// ---------------------------------------------------------------------------
// Production adapter over fetch + undici's WebSocket
// ---------------------------------------------------------------------------

/** Overall per-request deadline for the short REST calls (the probe, the gateway lookup, a send). */
const CALL_TIMEOUT_MS = 15_000;

/** Deadline for a file transfer in either direction: megabytes over whatever link the server has. */
const TRANSFER_TIMEOUT_MS = 60_000;

/** Gateway opcodes (the subset this adapter speaks). */
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

/**
 * The close code this client uses when IT abandons a socket it has given up on (a missed
 * heartbeat ack, a handshake that never completed). Any code but 1000 / 1001 keeps the
 * session resumable on the platform's side — closing with those two is documented to
 * invalidate it — and the 4xxx range above the platform's own codes is what its client
 * libraries use for the purpose.
 */
const CLIENT_DROP_CODE = 4200;

/**
 * Close codes after which the session handle is dead and the next handshake must identify
 * fresh: 4007 (invalid sequence) and 4009 (session timed out) are the two the platform
 * documents as "reconnect and start a new session". Everything else it closes with stays
 * resumable — including the routine 1000 / 1001 / 4000 a gateway node restart produces.
 */
function closeCodeInvalidatesSession(code: number): boolean {
  return code === 4007 || code === 4009;
}

/**
 * Close codes there is no point retrying: a rejected token (4004), and the identify
 * refusals — invalid shard (4010), sharding required (4011), invalid API version (4012),
 * invalid intents (4013), disallowed intents (4014). Each repeats identically until a human
 * changes the credential or a portal setting.
 */
function closeCodeIsFatal(code: number): boolean {
  return code === 4004 || (code >= 4010 && code <= 4014);
}

/**
 * Close codes the next handshake clears on its own, with nothing for anyone to change: the
 * platform cycling a long-lived socket (1000, 1001) and its own "unknown error" (4000), all
 * of which resume from `seq` with no inbound event missed. Deliberately narrower than
 * "reconnects" — see the QQ gateway's note of the same name.
 */
function closeCodeIsRoutine(code: number): boolean {
  return code === 1000 || code === 1001 || code === 4000;
}

/** What a fatal close means, in the words a status line can show. */
function fatalCloseText(code: number): string {
  if (code === 4004) return "the bot token was rejected — check it in the Discord developer portal";
  if (code === 4013 || code === 4014) {
    return "Discord refused the message intents this bot asked for";
  }
  return `Discord refused this connection (close code ${code})`;
}

/**
 * How long a socket has to finish its handshake before it is dropped and retried — the
 * same watchdog the QQ gateway carries, for the same half-open proxy shape.
 */
export const DISCORD_HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * The slice of the WebSocket API this session uses. Named as a type so a test can drive the
 * handshake, the heartbeat and every close code without opening a socket (the server suite
 * shares one module registry, so `vi.mock` is not available to it).
 */
export interface DiscordSocket {
  readonly readyState: number;
  addEventListener(type: "message", fn: (evt: { data: unknown }) => void): void;
  addEventListener(type: "error", fn: () => void): void;
  addEventListener(type: "close", fn: (evt: { code: number }) => void): void;
  send(data: string): void;
  /** `code` is what the platform sees; omitted, the socket sends a normal closure. */
  close(code?: number): void;
}

/** Gateway reconnect backoff: 1s doubling to a 60s ceiling (a revoked token retries once a minute). */
function defaultGatewayRetryMs(failures: number): number {
  return Math.min(1000 * 2 ** (failures - 1), 60_000);
}

/**
 * Readable failure text out of fetch's throw shapes. Nothing here may echo a request: the
 * authorization header carries the token.
 */
function fetchErrorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "request timed out";
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message !== "") return cause.message;
    return err.message;
  }
  return String(err);
}

/** The `{code, message}` envelope every REST refusal carries; 429 adds `retry_after`. */
interface DiscordErrorBody {
  code?: number;
  message?: string;
  retry_after?: number;
}

/**
 * A REST call the platform answered with a refusal, carrying the HTTP status and the
 * platform's own error code. A transport failure — a timeout, a reset, an unparseable body
 * — has neither and stays a plain Error, which keeps "the request never completed"
 * distinguishable from "Discord refused it"; nothing may retry the former, since the
 * message may well have been delivered.
 */
export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | undefined,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}

/**
 * The refusals whose own wording names an internal rule instead of the thing the operator
 * has to change, rewritten to lead with the action. Everything else passes through.
 */
export function discordErrorText(status: number, body: DiscordErrorBody | null): string {
  const message = body?.message ?? `HTTP ${status}`;
  if (status === 401) return `${message} — the bot token was rejected`;
  if (status === 429) {
    const wait = typeof body?.retry_after === "number" ? ` (retry after ${body.retry_after}s)` : "";
    return `${message} — Discord rate-limited this bot${wait}`;
  }
  if (body?.code === 50001 || body?.code === 50013) {
    return `${message} — the bot lacks permission in this channel (it needs View Channel, Send Messages and, for uploads, Attach Files)`;
  }
  if (body?.code === 50007) {
    return `${message} — this user does not accept direct messages from bots`;
  }
  if (status === 413 || body?.code === 40005) {
    return `${message} — the file is larger than this Discord server accepts from a bot`;
  }
  return message;
}

export interface DiscordTransportOpts {
  /** Test hook: gateway reconnect backoff (default: exponential, 1s → 60s). */
  gatewayRetryMs?: (failures: number) => number;
  /** Test hook: the socket the gateway session runs on (default: undici's WebSocket). */
  createSocket?: (url: string) => DiscordSocket;
  /** Test hook: the handshake deadline (default DISCORD_HANDSHAKE_TIMEOUT_MS). */
  handshakeTimeoutMs?: number;
  /**
   * Test seam: the `fetch` the REST calls go through. Production uses undici's own, for the
   * reason telegram-api.ts documents: it must be the same undici a `FormData` upload is
   * brand-checked against, and it resolves the proxy dispatcher per call.
   */
  fetch?: typeof undiciFetch;
}

/**
 * A response body as chunks, read through its reader so a transfer aborted over the ceiling
 * cancels the stream instead of draining the rest of the file.
 */
async function* bodyChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value !== undefined) yield value;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function createProductionClient(
  creds: DiscordCredentials,
  doFetch: typeof undiciFetch,
): DiscordBotClient {
  const authorization = `Bot ${creds.botToken}`;

  /** One REST call: the request, then the `{code, message}` envelope on anything but 2xx. */
  const request = async <T>(
    method: "GET" | "POST",
    path: string,
    body: string | FormData | undefined,
    opts: { timeoutMs?: number } = {},
  ): Promise<T> => {
    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await doFetch(`${DISCORD_API_BASE}${path}`, {
        method,
        headers: {
          authorization,
          // No content-type for a FormData body on purpose: fetch derives the multipart one,
          // boundary included, and a hand-written header would name a boundary the body does
          // not use.
          ...(typeof body === "string" ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(opts.timeoutMs ?? CALL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`${method} ${path} failed: ${fetchErrorText(err)}`);
    }
    if (res.status >= 200 && res.status < 300) {
      if (res.status === 204) return undefined as T;
      return (await res.json().catch(() => undefined)) as T;
    }
    const parsed = (await res.json().catch(() => null)) as DiscordErrorBody | null;
    const code = parsed?.code !== undefined ? ` (code ${parsed.code})` : "";
    throw new DiscordApiError(
      `${method} ${path} failed: ${discordErrorText(res.status, parsed)}${code}`,
      res.status,
      parsed?.code,
    );
  };

  return {
    getMe: () => request<DiscordBotUser>("GET", "/users/@me", undefined),
    async sendMessage({ channelId, content, replyToMessageId }): Promise<void> {
      await request(
        "POST",
        `/channels/${encodeURIComponent(channelId)}/messages`,
        JSON.stringify({
          content,
          // The reply is model output steerable by whoever is in the chat: it may render
          // `@everyone` as text, never ring it.
          allowed_mentions: { parse: [] },
          ...(replyToMessageId !== undefined
            ? {
                // Degrade to a plain send when the replied-to message is gone, rather than fail.
                message_reference: { message_id: replyToMessageId, fail_if_not_exists: false },
              }
            : {}),
        }),
      );
    },
    async sendFile({ channelId, fileName, data }): Promise<void> {
      const form = new FormData();
      form.append(
        "payload_json",
        JSON.stringify({
          attachments: [{ id: 0, filename: fileName }],
          allowed_mentions: { parse: [] },
        }),
      );
      form.append("files[0]", new Blob([data]), fileName);
      await request("POST", `/channels/${encodeURIComponent(channelId)}/messages`, form, {
        timeoutMs: TRANSFER_TIMEOUT_MS,
      });
    },
    async fetchAttachment({ url, maxBytes, what = "The file" }): Promise<Buffer> {
      let res: Awaited<ReturnType<typeof undiciFetch>>;
      try {
        // The CDN URL is pre-signed: no authorization header, and none must be sent.
        res = await doFetch(url, { signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS) });
      } catch (err) {
        throw new Error(`attachment download failed: ${fetchErrorText(err)}`);
      }
      if (!res.ok || res.body === null) {
        throw new Error(`attachment download failed: HTTP ${res.status}`);
      }
      // The declared size refuses an oversized transfer before it starts; the capped read
      // is what actually holds, since the claim can be absent or wrong.
      const declared = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new MessagingMediaTooLargeError(what, maxBytes);
      }
      return collectUnderCap(bodyChunks(res.body), maxBytes, what);
    },
  };
}

/** The production factory: plain HTTPS for REST, undici's WebSocket for the gateway. */
export function createDiscordTransport(opts: DiscordTransportOpts = {}): DiscordTransport {
  const retryMs = opts.gatewayRetryMs ?? defaultGatewayRetryMs;
  const createSocket =
    opts.createSocket ?? ((url: string): DiscordSocket => new WebSocket(url) as DiscordSocket);
  const handshakeMs = opts.handshakeTimeoutMs ?? DISCORD_HANDSHAKE_TIMEOUT_MS;
  const doFetch = opts.fetch ?? undiciFetch;
  return {
    createClient: (creds) => createProductionClient(creds, doFetch),
    async openGateway(creds, handlers): Promise<DiscordGatewayConnection> {
      const session = new GatewaySession(creds, doFetch, handlers, {
        retryMs,
        createSocket,
        handshakeMs,
      });
      session.start();
      return { close: () => session.close() };
    },
  };
}

/** One gateway frame. `s` and `t` ride dispatches only. */
export interface DiscordGatewayFrame {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

/**
 * One gateway session with its own reconnect loop — the QQ GatewaySession's lifecycle with
 * this platform's rules, which differ in three places:
 *
 *   - RESUME must be sent to the `resume_gateway_url` READY handed back, not to the URL
 *     `GET /gateway/bot` answered; a resume attempted on the original URL is refused.
 *   - INVALID_SESSION carries a boolean: `true` means the handle is still good and a resume
 *     may be retried, `false` means identify fresh.
 *   - IDENTIFY needs a `properties` object naming the client; the token goes in bare.
 *
 * Everything else is the same contract: HELLO carries the heartbeat interval, every
 * dispatch's `s` is the sequence a resume rewinds to, a handshake watchdog and a heartbeat
 * watchdog drop a half-open socket into the same fail-and-back-off path a real close takes,
 * `onReady` fires per successful handshake and `onError` once per outage.
 */
class GatewaySession {
  private ws: DiscordSocket | null = null;
  private closed = false;
  private failures = 0;
  /** The resume handle from READY; null until the first successful identify. */
  private sessionId: string | null = null;
  /** Where a RESUME must connect to, from the same READY. */
  private resumeUrl: string | null = null;
  /** Latest dispatch sequence (the heartbeat's `d`, and the resume's). */
  private seq: number | null = null;
  /** Cached `GET /gateway/bot` URL, reused across fresh identifies. */
  private gatewayUrl: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Armed with the socket, disarmed by the handshake: see DISCORD_HANDSHAKE_TIMEOUT_MS. */
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the last HEARTBEAT_ACK arrived, against which the heartbeat tick measures silence. */
  private lastAckAt = 0;
  /** This outage already reported; the retries stay quiet until a handshake succeeds. */
  private reported = false;

  constructor(
    private readonly creds: DiscordCredentials,
    private readonly doFetch: typeof undiciFetch,
    private readonly handlers: DiscordGatewayHandlers,
    private readonly opts: {
      retryMs: (failures: number) => number;
      createSocket: (url: string) => DiscordSocket;
      handshakeMs: number;
    },
  ) {}

  start(): void {
    void this.connect();
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    this.disarmHandshake();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    try {
      // A normal closure: the binding is going dark on purpose, and the session may die.
      ws?.close(1000);
    } catch {
      // A socket already closing throws on some paths; the session is going away regardless.
    }
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    try {
      const url = await this.urlFor(this.sessionId !== null);
      if (this.closed) return;
      this.openSocket(url);
    } catch (err) {
      this.fail(err);
    }
  }

  /** The URL for the next socket: the resume one while a session handle is held, the lookup otherwise. */
  private async urlFor(resuming: boolean): Promise<string> {
    if (resuming && this.resumeUrl !== null) return withGatewayQuery(this.resumeUrl);
    this.gatewayUrl ??= await this.fetchGatewayUrl();
    return withGatewayQuery(this.gatewayUrl);
  }

  private async fetchGatewayUrl(): Promise<string> {
    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await this.doFetch(`${DISCORD_API_BASE}/gateway/bot`, {
        headers: { authorization: `Bot ${this.creds.botToken}` },
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Gateway lookup failed: ${fetchErrorText(err)}`);
    }
    const body = (await res.json().catch(() => null)) as
      (DiscordGatewayInfo & DiscordErrorBody) | null;
    if (!res.ok || body === null || typeof body.url !== "string" || body.url === "") {
      throw new Error(`Gateway lookup failed: ${discordErrorText(res.status, body)}`);
    }
    return body.url;
  }

  private openSocket(url: string): void {
    const ws = this.opts.createSocket(url);
    this.ws = ws;
    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = null;
      this.dropSocket(ws, new Error("gateway handshake did not complete"));
    }, this.opts.handshakeMs);
    this.handshakeTimer.unref?.();
    ws.addEventListener("message", (evt) => {
      if (this.ws !== ws) return;
      this.onFrame(String(evt.data));
    });
    // A WebSocket `error` event carries no usable detail and is always followed by `close`,
    // which is where the outage is reported; this listener exists so it is not unhandled.
    ws.addEventListener("error", () => {});
    ws.addEventListener("close", (evt) => {
      if (this.ws !== ws) return;
      this.stopHeartbeat();
      this.disarmHandshake();
      this.ws = null;
      if (closeCodeInvalidatesSession(evt.code)) this.forgetSession();
      if (closeCodeIsFatal(evt.code)) {
        this.closed = true;
        this.handlers.onError?.(
          new MessagingConnectionClosedError(
            `${fatalCloseText(evt.code)} (close code ${evt.code})`,
            evt.code,
            false,
          ),
        );
        return;
      }
      this.fail(
        new MessagingConnectionClosedError(
          `gateway connection closed (code ${evt.code})`,
          evt.code,
          closeCodeIsRoutine(evt.code),
        ),
      );
    });
  }

  private forgetSession(): void {
    this.sessionId = null;
    this.resumeUrl = null;
    this.seq = null;
  }

  private onFrame(raw: string): void {
    let frame: DiscordGatewayFrame;
    try {
      frame = JSON.parse(raw) as DiscordGatewayFrame;
    } catch {
      return;
    }
    if (typeof frame.s === "number") this.seq = frame.s;
    switch (frame.op) {
      case OP.HELLO: {
        const interval = (frame.d as { heartbeat_interval?: number } | undefined)
          ?.heartbeat_interval;
        this.startHeartbeat(typeof interval === "number" && interval > 0 ? interval : 41_250);
        this.send(
          this.sessionId !== null
            ? {
                op: OP.RESUME,
                d: { token: this.creds.botToken, session_id: this.sessionId, seq: this.seq ?? 0 },
              }
            : {
                op: OP.IDENTIFY,
                d: {
                  token: this.creds.botToken,
                  intents: DISCORD_INTENTS,
                  properties: {
                    os: process.platform,
                    browser: "penguin-harness",
                    device: "penguin-harness",
                  },
                },
              },
        );
        return;
      }
      case OP.DISPATCH:
        this.onDispatch(frame);
        return;
      case OP.INVALID_SESSION:
        // `d: true` says the handle survived and a resume may be retried on the next
        // socket; `d: false` says identify fresh. Either way this socket is done.
        if (frame.d !== true) this.forgetSession();
        this.ws?.close(CLIENT_DROP_CODE);
        return;
      case OP.RECONNECT:
        // Politely asked to reconnect; the session stays resumable.
        this.ws?.close(CLIENT_DROP_CODE);
        return;
      case OP.HEARTBEAT:
        // The platform may ask for one out of turn; it wants it immediately.
        this.send({ op: OP.HEARTBEAT, d: this.seq });
        return;
      case OP.HEARTBEAT_ACK:
        this.lastAckAt = Date.now();
        return;
      default:
        return;
    }
  }

  private onDispatch(frame: DiscordGatewayFrame): void {
    if (frame.t === "READY") {
      const d = frame.d as { session_id?: string; resume_gateway_url?: string } | undefined;
      if (typeof d?.session_id === "string") this.sessionId = d.session_id;
      if (typeof d?.resume_gateway_url === "string") this.resumeUrl = d.resume_gateway_url;
      this.onHandshake();
      return;
    }
    if (frame.t === "RESUMED") {
      this.onHandshake();
      return;
    }
    if (frame.t === "MESSAGE_CREATE") {
      const msg = messageOf(frame.d);
      if (msg !== null) void this.handlers.onMessage(msg);
    }
  }

  /** A handshake completed: the outage (if any) is over and the backoff resets. */
  private onHandshake(): void {
    this.disarmHandshake();
    this.failures = 0;
    this.reported = false;
    this.handlers.onReady?.();
  }

  private disarmHandshake(): void {
    if (this.handshakeTimer !== null) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }

  /** Abandons a socket the session has given up on and starts the backoff itself (see the QQ gateway). */
  private dropSocket(ws: DiscordSocket, err: Error): void {
    if (this.ws !== ws) return;
    this.stopHeartbeat();
    this.disarmHandshake();
    this.ws = null;
    try {
      ws.close(CLIENT_DROP_CODE);
    } catch {
      // A socket already going away throws on some paths and it changes nothing here.
    }
    this.fail(err);
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    const ws = this.ws;
    if (ws === null) return;
    this.lastAckAt = Date.now();
    this.heartbeat = setInterval(() => {
      // Two intervals of silence: the platform acknowledges every heartbeat, so a socket
      // still writable but no longer answering is a dead pipe rather than a slow one.
      if (Date.now() - this.lastAckAt > intervalMs * 2) {
        this.dropSocket(ws, new Error("gateway stopped acknowledging heartbeats"));
        return;
      }
      this.send({ op: OP.HEARTBEAT, d: this.seq });
    }, intervalMs);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private send(frame: DiscordGatewayFrame): void {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
    } catch {
      // A send into a socket that died between the check and the write is the same outage
      // the `close` handler is about to report.
    }
  }

  /** One report per outage, then retry with backoff. */
  private fail(err: unknown): void {
    if (this.closed) return;
    this.failures += 1;
    // A routine close never takes the outage's one report slot: filed `expected`, it would
    // otherwise silence a refusal that follows it (see the QQ gateway's note).
    const routine = err instanceof MessagingConnectionClosedError && err.recovers;
    if (!this.reported) {
      if (!routine) this.reported = true;
      this.handlers.onError?.(err);
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, this.opts.retryMs(this.failures));
    this.retryTimer.unref?.();
  }
}

/** The gateway URL with this client's version and encoding, whichever endpoint handed it out. */
function withGatewayQuery(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${GATEWAY_QUERY}`;
}

/**
 * One `MESSAGE_CREATE` payload reduced to the slice the connector reads; null when the
 * frame is not shaped like a message at all. Nothing here decides whether the message is
 * wanted — that is the connector's (see discord-connector.ts normalizeMessage).
 */
export function messageOf(d: unknown): DiscordMessage | null {
  const m = d as Partial<DiscordMessage> | undefined;
  if (
    m === undefined ||
    typeof m.id !== "string" ||
    m.id === "" ||
    typeof m.channel_id !== "string" ||
    m.channel_id === "" ||
    typeof m.author?.id !== "string"
  ) {
    return null;
  }
  return {
    id: m.id,
    channel_id: m.channel_id,
    ...(typeof m.guild_id === "string" ? { guild_id: m.guild_id } : {}),
    author: {
      id: m.author.id,
      username: typeof m.author.username === "string" ? m.author.username : "",
      ...(m.author.global_name !== undefined ? { global_name: m.author.global_name } : {}),
      ...(m.author.bot !== undefined ? { bot: m.author.bot } : {}),
    },
    content: typeof m.content === "string" ? m.content : "",
    ...(Array.isArray(m.attachments) ? { attachments: m.attachments } : {}),
    ...(Array.isArray(m.mentions) ? { mentions: m.mentions } : {}),
    type: typeof m.type === "number" ? m.type : 0,
  };
}
