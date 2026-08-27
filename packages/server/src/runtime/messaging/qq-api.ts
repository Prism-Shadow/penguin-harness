/**
 * The QQ bot open-platform (API v2) seam: the app-access-token exchange, the two message
 * sends, and the WebSocket gateway, behind an injectable transport so unit tests
 * substitute a fake and never open a socket to Tencent. QQ publishes no Node SDK this
 * product can take (the one Tencent ships for the scan flow is `UNLICENSED`), so the
 * production adapter is plain fetch plus undici's WebSocket — both of which resolve
 * undici's global dispatcher per call, which is how they inherit the admin proxy setting
 * (net/proxy.ts) without asking for it.
 *
 * Wire types below mirror the platform's JSON verbatim (snake_case): the transport does
 * not reshape payloads, so a test fake constructs exactly what the real API returns.
 *
 * Two properties of this platform shape the whole seam, and every caller downstream
 * inherits them:
 *
 *   1. AUTH IS A SHORT-LIVED TOKEN, NOT THE CREDENTIAL. Every OpenAPI call carries
 *      `Authorization: QQBot <access_token>`, and that token lasts at most 7200 seconds.
 *      The credential pair (App ID + App Secret) only ever buys a new one. So the client
 *      owns a token cache with early refresh rather than making callers think about it —
 *      and the platform documents that a request inside the last 60 seconds of validity
 *      returns a NEW token while the old one keeps working for those 60 seconds, so
 *      refreshing early can never strand a request that is already in flight.
 *   2. THE GATEWAY IS THE ONLY WAY IN FOR A LOCAL SERVER. QQ also offers an HTTP callback
 *      mode, but it needs a publicly reachable HTTPS URL on one of four ports (80, 443,
 *      8080, 8443) plus an Ed25519 challenge response — the same class of constraint that
 *      made Feishu a long connection and Telegram a long poll. So this seam opens a
 *      WebSocket, identifies with the group-and-C2C intent, heartbeats, and resumes.
 *
 * A THIRD property does not live here but is worth naming from the transport, because it
 * is the reason `QQSendArgs` has no "just send" shape: QQ has no free outbound. Every send
 * this product makes is a PASSIVE REPLY carrying the `msg_id` of an inbound message, and
 * that is a budget — see qq-connector.ts, which owns the accounting.
 */
import { WebSocket } from "undici";

/**
 * QQ bot OpenAPI host — both the token endpoint and the resource endpoints. Deliberately
 * not configurable: API v2 has no separate sandbox host (a sandbox in v2 is a whitelist of
 * groups and accounts configured in the console, served by this same host), so there is
 * nothing for a domain field to switch between, unlike Feishu's Feishu/Lark split.
 */
export const QQ_API_BASE = "https://api.bot.qq.com";

/**
 * The one intent this bot subscribes: `GROUP_AND_C2C_EVENT` (1 << 25). It carries the two
 * events this product reads — `C2C_MESSAGE_CREATE` (a single chat with the bot) and
 * `GROUP_AT_MESSAGE_CREATE` (a group message that @-mentions it) — along with eight
 * others (friend add/remove, the push-permission toggles, robot add/remove) that
 * normalizeDispatch drops.
 *
 * Nothing else is subscribed. Guild intents a bot has no permission for are refused at
 * identify with close code 4014, and this product has no use for them.
 */
export const QQ_INTENT_GROUP_AND_C2C = 1 << 25;

/** One credential set (a binding's stored values, or a test request's draft). */
export interface QQCredentials {
  /** The bot's App ID — also the channel-scoped account identity; never secret. */
  appId: string;
  /** The App Secret from the developer console (the platform's `clientSecret`). */
  appSecret: string;
}

/**
 * `POST /app/getAppAccessToken` result. `expires_in` is seconds and never exceeds 7200 —
 * typed as a union because the platform's own response example returns it quoted while its
 * field table calls it a number.
 */
export interface QQAppAccessToken {
  access_token: string;
  expires_in: number | string;
}

/** `GET /gateway` result: the WebSocket URL to connect to. */
export interface QQGatewayInfo {
  url: string;
}

/**
 * Which side of the platform a chat lives on. It selects the send endpoint AND the passive
 * reply budget, which is not the same on both (see qq-connector.ts).
 */
export type QQChatKind = "c2c" | "group";

/**
 * One inbound message event, reduced to what the connector consumes. `openid` is the
 * conversation's own id — the user's for a single chat, the group's for a group — which is
 * also the send endpoint's path segment, so it doubles as the chat id.
 */
export interface QQInboundEvent {
  kind: QQChatKind;
  /** `author.user_openid` for a single chat, `group_openid` for a group. */
  openid: string;
  /** The platform's message id (`d.id`): the passive reply's `msg_id`, and the dedupe key. */
  messageId: string;
  /**
   * Message text, already trimmed. The platform strips the `@bot` prefix from a group
   * message's content itself but leaves the whitespace it sat in, so the trim is the
   * connector's half of that contract.
   */
  content: string;
  /** Sender openid (`author.user_openid` in a single chat, `author.member_openid` in a group). */
  senderOpenid?: string;
}

/**
 * One outbound send. Always a PASSIVE reply: `msgId` names the inbound message being
 * answered, and `msgSeq` orders the replies to it. There is no push shape here on purpose —
 * see the module doc.
 */
export interface QQSendArgs {
  kind: QQChatKind;
  openid: string;
  content: string;
  /** The inbound message being answered — what makes this a passive reply rather than a push. */
  msgId: string;
  /**
   * Sequence among the replies to `msgId`, 1-based (the platform's own default is 1).
   * A repeated `msg_id` + `msg_seq` pair is REJECTED (40054005 消息被去重), not ignored, so
   * this must genuinely increment per reply.
   */
  msgSeq: number;
}

/** OpenAPI half of the seam, bound to one credential pair. Every method throws on failure with a readable reason. */
export interface QQBotClient {
  /**
   * Credential check: exchanges the App ID / App Secret for an access token. The platform
   * has no cheaper "who am I" call — and no call at all that identifies the bot by name —
   * so the exchange itself is the probe and there is no account label to surface.
   */
  checkCredentials(): Promise<void>;
  /** Sends one passive text reply into a single chat or a group. */
  sendMessage(args: QQSendArgs): Promise<void>;
}

export interface QQGatewayHandlers {
  onMessage(evt: QQInboundEvent): void | Promise<void>;
  /** The gateway completed a handshake (fires again after an automatic reconnect). */
  onReady?(): void;
  /** The gateway failed; reported once per outage, as the Telegram poll loop does. */
  onError?(err: unknown): void;
}

/** A live gateway session; `close` ends it and stops reconnecting (idempotent). */
export interface QQGatewayConnection {
  close(): void;
}

/** Factory the QQ connector is built over: the production adapter, or a test fake. */
export interface QQTransport {
  createClient(creds: QQCredentials): QQBotClient;
  /**
   * Opens the gateway for one bot. Resolves as soon as the session is constructed and
   * connecting — lifecycle arrives via the handlers (`onReady` / `onError`), because the
   * adapter reconnects on its own and a single promise cannot carry a lifecycle.
   */
  openGateway(creds: QQCredentials, handlers: QQGatewayHandlers): Promise<QQGatewayConnection>;
}

// ---------------------------------------------------------------------------
// Production adapter over fetch + undici's WebSocket
// ---------------------------------------------------------------------------

/** Overall per-request deadline for the OpenAPI calls (token exchange, gateway lookup, sends). */
const CALL_TIMEOUT_MS = 15_000;

/**
 * Refresh the access token this many seconds before it expires. The platform keeps the
 * previous token valid for exactly this long while it issues a replacement, so the margin
 * is the documented overlap rather than a guess.
 */
const TOKEN_REFRESH_MARGIN_SEC = 60;

/** Gateway opcodes (the subset this adapter speaks; the platform reuses Discord's numbering). */
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
 * Close codes that mean "this session handle is dead, identify fresh next time" (4006
 * invalid session id, 4007 sequence error, and the 4900-4913 internal band the platform's
 * own guidance says to re-identify after). 4009 — connection expired — is the one drop
 * that stays resumable, which is why it is absent here.
 */
function closeCodeInvalidatesSession(code: number): boolean {
  return code === 4006 || code === 4007 || (code >= 4900 && code <= 4913);
}

/**
 * Close codes there is no point retrying: the bot is delisted (4914, connectable only in
 * the console's sandbox whitelist) or banned (4915). Reconnecting on a one-minute ceiling
 * forever would just log the same refusal until someone looks.
 */
function closeCodeIsFatal(code: number): boolean {
  return code === 4914 || code === 4915;
}

/**
 * How long a socket has to finish its handshake before it is dropped and retried.
 *
 * A socket that opened and then went quiet — a proxy that accepted the upgrade and
 * blackholed everything after it — never reaches HELLO, never starts a heartbeat, and never
 * fires `close`. Nothing else in this session would notice, so the binding would sit at
 * `connected` receiving nothing, forever. Generous next to a handshake that normally takes
 * one round trip.
 */
export const QQ_HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * The slice of the WebSocket API this session uses.
 *
 * Named as a type so a test can drive the handshake, the heartbeat and every close code
 * without opening a socket. It is not a module mock on purpose: the server suite shares one
 * module registry across files (see vitest.config.ts), so `vi.mock` is not available to it.
 */
export interface QQSocket {
  readonly readyState: number;
  addEventListener(type: "message", fn: (evt: { data: unknown }) => void): void;
  addEventListener(type: "error", fn: () => void): void;
  addEventListener(type: "close", fn: (evt: { code: number }) => void): void;
  send(data: string): void;
  close(): void;
}

/** Gateway reconnect backoff: 1s doubling to a 60s ceiling (a revoked secret retries once a minute). */
function defaultGatewayRetryMs(failures: number): number {
  return Math.min(1000 * 2 ** (failures - 1), 60_000);
}

/**
 * Readable failure text out of fetch's throw shapes. Nothing here may echo a request body:
 * the token exchange's carries the App Secret.
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

/**
 * The failure envelope. The OpenAPI answers `{err_code, message, trace_id}` and the token
 * endpoint answers `{code, message}` — two different families, so both are read and
 * `err_code` wins where the platform sends both.
 */
interface QQErrorBody {
  code?: number;
  err_code?: number;
  message?: string;
}

/**
 * The send failures whose own wording names an internal rule instead of the thing the
 * operator has to change. Everything else passes through untouched.
 *
 * 40034128 is the one this product can genuinely provoke on its own — the platform folds
 * "the reply window closed" and "the reply count ran out" into a single code, so the text
 * has to name both. qq-connector.ts exists largely to keep it from ever being returned.
 */
export function qqSendErrorText(errCode: number | undefined, message: string): string {
  if (errCode === 40034128) {
    return `${message} — QQ allows only a few replies to one message, within minutes of it`;
  }
  if (errCode === 40034005 || errCode === 304103 || errCode === 40034024) {
    return `${message} — the QQ message being replied to has expired`;
  }
  if (errCode === 40034105 || errCode === 40054013) {
    return `${message} — this QQ user has turned off messages from bots`;
  }
  return message;
}

export interface QQTransportOpts {
  /** Test hook: gateway reconnect backoff (default: exponential, 1s → 60s). */
  gatewayRetryMs?: (failures: number) => number;
  /** Test hook: the socket the gateway session runs on (default: undici's WebSocket). */
  createSocket?: (url: string) => QQSocket;
  /** Test hook: the handshake deadline (default QQ_HANDSHAKE_TIMEOUT_MS). */
  handshakeTimeoutMs?: number;
}

/** One bot's access token with early refresh, shared by the OpenAPI client and the gateway identify. */
interface TokenCache {
  get(): Promise<string>;
  invalidate(): void;
}

function tokenCacheOf(creds: QQCredentials): TokenCache {
  let token = "";
  let expiresAtMs = 0;
  let inFlight: Promise<string> | null = null;

  const exchange = async (): Promise<string> => {
    let res: Response;
    try {
      res = await fetch(`${QQ_API_BASE}/app/getAppAccessToken`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: creds.appId, clientSecret: creds.appSecret }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Token exchange failed: ${fetchErrorText(err)}`);
    }
    const body = (await res.json().catch(() => null)) as (QQAppAccessToken & QQErrorBody) | null;
    if (body === null || typeof body.access_token !== "string" || body.access_token === "") {
      const detail = body?.message ?? `HTTP ${res.status}`;
      const code = body?.code ?? body?.err_code;
      throw new Error(
        `Token exchange failed: ${detail}${code !== undefined ? ` (code ${code})` : ""}`,
      );
    }
    const ttl = Number(body.expires_in);
    // A missing or nonsensical TTL falls back to the platform's own ceiling rather than
    // caching forever on a malformed response.
    const seconds = Number.isFinite(ttl) && ttl > 0 ? Math.min(ttl, 7200) : 7200;
    token = body.access_token;
    expiresAtMs = Date.now() + Math.max(seconds - TOKEN_REFRESH_MARGIN_SEC, 1) * 1000;
    return token;
  };

  return {
    async get(): Promise<string> {
      if (token !== "" && Date.now() < expiresAtMs) return token;
      // Collapse concurrent refreshes: a burst of sends must not each buy a token, which
      // the endpoint rate-limits (100001 Too many requests).
      inFlight ??= exchange().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    invalidate(): void {
      expiresAtMs = 0;
    },
  };
}

/** The production client, plus the token cache the gateway session needs for its identify. */
interface ProductionClient extends QQBotClient {
  tokens: TokenCache;
}

function createProductionClient(creds: QQCredentials): ProductionClient {
  const tokens = tokenCacheOf(creds);

  const post = async (path: string, payload: Record<string, unknown>, retry = true) => {
    const token = await tokens.get();
    let res: Response;
    try {
      res = await fetch(`${QQ_API_BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `QQBot ${token}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Message send failed: ${fetchErrorText(err)}`);
    }
    if (res.status >= 200 && res.status < 300) return;
    const body = (await res.json().catch(() => null)) as QQErrorBody | null;
    if (res.status === 401) {
      // The cached token died before its stated expiry — a secret rotated in the console,
      // or a clock further off than the refresh margin covers. Drop it and replay ONCE, so
      // a genuinely revoked credential still surfaces as an error instead of looping.
      tokens.invalidate();
      if (retry) return post(path, payload, false);
    }
    const errCode = body?.err_code ?? body?.code;
    const detail = qqSendErrorText(errCode, body?.message ?? `HTTP ${res.status}`);
    throw new Error(
      `Message send failed: ${detail}${errCode !== undefined ? ` (code ${errCode})` : ""}`,
    );
  };

  return {
    tokens,
    async checkCredentials(): Promise<void> {
      await tokens.get();
    },
    sendMessage(args: QQSendArgs): Promise<void> {
      const path =
        args.kind === "group"
          ? `/v2/groups/${encodeURIComponent(args.openid)}/messages`
          : `/v2/users/${encodeURIComponent(args.openid)}/messages`;
      return post(path, {
        content: args.content,
        // 0 = plain text. Markdown, ark and rich-media types each need separate approval.
        msg_type: 0,
        msg_id: args.msgId,
        msg_seq: args.msgSeq,
      });
    },
  };
}

/** The production factory: plain HTTPS for the OpenAPI, undici's WebSocket for the gateway. */
export function createQQTransport(opts: QQTransportOpts = {}): QQTransport {
  const retryMs = opts.gatewayRetryMs ?? defaultGatewayRetryMs;
  const createSocket = opts.createSocket ?? ((url: string): QQSocket => new WebSocket(url));
  const handshakeMs = opts.handshakeTimeoutMs ?? QQ_HANDSHAKE_TIMEOUT_MS;
  return {
    createClient: (creds) => createProductionClient(creds),
    async openGateway(creds, handlers): Promise<QQGatewayConnection> {
      const session = new GatewaySession(createProductionClient(creds), handlers, {
        retryMs,
        createSocket,
        handshakeMs,
      });
      session.start();
      return { close: () => session.close() };
    },
  };
}

/**
 * One gateway session with its own reconnect loop.
 *
 * Every step of the handshake is the platform's, and each earns its line: HELLO carries the
 * heartbeat interval in milliseconds (a socket that stops sending them is closed), IDENTIFY
 * authenticates with the same `QQBot <token>` string the OpenAPI takes (a still-published
 * doc page describes a `Bot <appid>.<token>` form — that is the retired v1 scheme and it is
 * rejected), READY hands back a `session_id` that RESUME replays a dropped connection from,
 * and every DISPATCH's `s` is the sequence RESUME rewinds to — so `seq` is tracked from the
 * first frame, not from the first message.
 *
 * The reconnect decision is protocol state nobody above this file holds, which is why it
 * lives here: a close is resumable unless its code says the session handle is dead (4006 /
 * 4007 / the internal band), an INVALID_SESSION says the resume was refused, and a
 * RECONNECT is the platform asking for the same round trip while keeping the session
 * resumable. Two codes end the session for good — a delisted or banned bot will not connect
 * however long it is retried.
 *
 * The gateway URL is fetched once and reused across reconnects: `GET /gateway` is rate
 * limited to 2 requests a minute, which a reconnect storm would spend on nothing.
 *
 * Two watchdogs bound a session that is neither speaking nor closing, because a socket that
 * stops carrying traffic without a FIN — a NAT or proxy drop, and this path deliberately
 * inherits the admin proxy dispatcher — keeps `readyState` OPEN and fires no `close` at
 * all: one deadline on the handshake (QQ_HANDSHAKE_TIMEOUT_MS), and one on the heartbeat,
 * which the platform acknowledges with HEARTBEAT_ACK and which is therefore a round trip
 * rather than a write. Either drops the socket into the same fail-and-back-off path a real
 * close takes — and drives it directly rather than waiting on a `close` event a half-open
 * socket may never produce.
 *
 * What surfaces upward is only the outcome: `onReady` per successful handshake, `onError`
 * once per outage — the same contract the Feishu long connection and the Telegram poll loop
 * report, so the bridge's status means the same thing on all three channels.
 */
class GatewaySession {
  private ws: QQSocket | null = null;
  private closed = false;
  private failures = 0;
  /** The resume handle from READY; null until the first successful identify. */
  private sessionId: string | null = null;
  /** Latest dispatch sequence (the heartbeat's `d`, and the resume's). */
  private seq: number | null = null;
  /** Cached `GET /gateway` URL (see the class doc: 2 QPM). */
  private gatewayUrl: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Armed with the socket, disarmed by the handshake: see QQ_HANDSHAKE_TIMEOUT_MS. */
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the last HEARTBEAT_ACK arrived, against which the heartbeat tick measures silence. */
  private lastAckAt = 0;
  /** This outage already reported; the retries stay quiet until a handshake succeeds. */
  private reported = false;

  constructor(
    private readonly client: ProductionClient,
    private readonly handlers: QQGatewayHandlers,
    private readonly opts: {
      retryMs: (failures: number) => number;
      createSocket: (url: string) => QQSocket;
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
      ws?.close();
    } catch {
      // A socket already closing throws on some paths; the session is going away regardless.
    }
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    try {
      const token = await this.client.tokens.get();
      if (this.closed) return;
      this.gatewayUrl ??= await this.fetchGatewayUrl(token);
      if (this.closed) return;
      this.openSocket(this.gatewayUrl, token);
    } catch (err) {
      this.fail(err);
    }
  }

  private async fetchGatewayUrl(token: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${QQ_API_BASE}/gateway`, {
        headers: { authorization: `QQBot ${token}` },
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Gateway lookup failed: ${fetchErrorText(err)}`);
    }
    const body = (await res.json().catch(() => null)) as (QQGatewayInfo & QQErrorBody) | null;
    if (body === null || typeof body.url !== "string" || body.url === "") {
      throw new Error(`Gateway lookup failed: ${body?.message ?? `HTTP ${res.status}`}`);
    }
    return body.url;
  }

  private openSocket(url: string, token: string): void {
    const ws = this.opts.createSocket(url);
    this.ws = ws;
    // The socket is open; nothing says the far end is listening. This is the deadline for
    // it to prove it, and it covers both silences: no HELLO, and an IDENTIFY nobody answers.
    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = null;
      this.dropSocket(ws, new Error("gateway handshake did not complete"));
    }, this.opts.handshakeMs);
    this.handshakeTimer.unref?.();
    ws.addEventListener("message", (evt) => {
      if (this.ws !== ws) return;
      this.onFrame(String(evt.data), token);
    });
    // A WebSocket `error` event carries no usable detail and is always followed by `close`,
    // which is where the outage is reported; this listener exists so it is not unhandled.
    ws.addEventListener("error", () => {});
    ws.addEventListener("close", (evt) => {
      if (this.ws !== ws) return;
      this.stopHeartbeat();
      this.disarmHandshake();
      this.ws = null;
      if (closeCodeInvalidatesSession(evt.code)) {
        this.sessionId = null;
        this.seq = null;
      }
      if (closeCodeIsFatal(evt.code)) {
        this.closed = true;
        this.handlers.onError?.(
          new Error(
            `gateway refused this bot (close code ${evt.code}) — it is delisted or banned on the QQ open platform`,
          ),
        );
        return;
      }
      this.fail(new Error(`gateway connection closed (code ${evt.code})`));
    });
  }

  private onFrame(raw: string, token: string): void {
    let frame: QQGatewayFrame;
    try {
      frame = JSON.parse(raw) as QQGatewayFrame;
    } catch {
      return;
    }
    if (typeof frame.s === "number") this.seq = frame.s;
    switch (frame.op) {
      case OP.HELLO: {
        const interval = (frame.d as { heartbeat_interval?: number } | undefined)
          ?.heartbeat_interval;
        this.startHeartbeat(typeof interval === "number" && interval > 0 ? interval : 45_000);
        // A session handle from a previous connection makes this a resume; otherwise identify.
        this.send(
          this.sessionId !== null
            ? {
                op: OP.RESUME,
                d: { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.seq ?? 0 },
              }
            : {
                op: OP.IDENTIFY,
                d: {
                  token: `QQBot ${token}`,
                  intents: QQ_INTENT_GROUP_AND_C2C,
                  // Unsharded: this product runs one connection per bot.
                  shard: [0, 1],
                  // Documented as having no effect today; sent empty rather than inventing values.
                  properties: {},
                },
              },
        );
        return;
      }
      case OP.DISPATCH:
        this.onDispatch(frame);
        return;
      case OP.INVALID_SESSION:
        // The resume was refused: forget the handle so the next handshake identifies fresh.
        this.sessionId = null;
        this.seq = null;
        this.ws?.close();
        return;
      case OP.RECONNECT:
        // Politely asked to reconnect; the session stays resumable.
        this.ws?.close();
        return;
      case OP.HEARTBEAT_ACK:
        // The one frame that proves the socket is still a round trip rather than a write
        // into a dead pipe. startHeartbeat measures its silence.
        this.lastAckAt = Date.now();
        return;
      default:
        // The webhook-only opcodes need no action.
        return;
    }
  }

  private onDispatch(frame: QQGatewayFrame): void {
    if (frame.t === "READY") {
      const d = frame.d as { session_id?: string } | undefined;
      if (typeof d?.session_id === "string") this.sessionId = d.session_id;
      this.onHandshake();
      return;
    }
    if (frame.t === "RESUMED") {
      this.onHandshake();
      return;
    }
    const evt = normalizeDispatch(frame);
    if (evt !== null) void this.handlers.onMessage(evt);
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

  /**
   * Abandons a socket the session has given up on and starts the backoff itself.
   *
   * The `close` handler is not enough on its own here: the failure both watchdogs cover is
   * a socket that never fires `close`, and asking a half-open one to close is a request the
   * far end may never answer. Detaching first makes the `close` that may eventually arrive
   * a no-op (every listener is gated on `this.ws === ws`).
   */
  private dropSocket(ws: QQSocket, err: Error): void {
    if (this.ws !== ws) return;
    this.stopHeartbeat();
    this.disarmHandshake();
    this.ws = null;
    try {
      ws.close();
    } catch {
      // Same as close(): a socket already going away throws on some paths and it changes
      // nothing here.
    }
    this.fail(err);
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    const ws = this.ws;
    if (ws === null) return;
    // HELLO is the last thing heard from this socket so far, which is what the first
    // interval is measured against.
    this.lastAckAt = Date.now();
    this.heartbeat = setInterval(() => {
      // Two intervals of silence: the platform acknowledges every heartbeat, so a socket
      // still writable but no longer answering is a dead pipe rather than a slow one. One
      // interval would be a lost ack; two is an outage.
      if (Date.now() - this.lastAckAt > intervalMs * 2) {
        this.dropSocket(ws, new Error("gateway stopped acknowledging heartbeats"));
        return;
      }
      this.send({ op: OP.HEARTBEAT, d: this.seq });
    }, intervalMs);
    // A heartbeat must never be the reason the process cannot exit.
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private send(frame: QQGatewayFrame): void {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
    } catch {
      // A send into a socket that died between the check and the write is the same outage
      // the `close` handler is about to report; there is nothing extra to say here.
    }
  }

  /** One report per outage, then retry with backoff — the Telegram poll loop's contract. */
  private fail(err: unknown): void {
    if (this.closed) return;
    this.failures += 1;
    if (!this.reported) {
      this.reported = true;
      this.handlers.onError?.(err);
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, this.opts.retryMs(this.failures));
    this.retryTimer.unref?.();
  }
}

/** One gateway frame. `s` and `t` ride dispatches only. */
export interface QQGatewayFrame {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
  /** The dispatch's own event id (an alternative passive-reply anchor this product does not use). */
  id?: string;
}

/**
 * One dispatch frame reduced to the connector's inbound shape; null for anything that is
 * not one of the two message events this product answers.
 *
 * A single-chat message and a group @-message differ in exactly two places — where the
 * conversation's openid lives, and which author field carries the sender — so they
 * normalize to one record with a `kind` discriminator rather than two shapes. The group
 * event's sender is `author.member_openid`, NOT `user_openid`: that field exists on the
 * group event too and is empty there, so reading it would quietly yield blanks.
 *
 * `GROUP_MESSAGE_CREATE` — every group message rather than only the @-mentions — rides the
 * same intent when a console switch is on, and is deliberately dropped: a bot that answered
 * everything said in a group is not what binding a conversation to it asks for.
 */
export function normalizeDispatch(frame: QQGatewayFrame): QQInboundEvent | null {
  const d = frame.d as
    | {
        id?: string;
        content?: string;
        group_openid?: string;
        author?: { user_openid?: string; member_openid?: string };
      }
    | undefined;
  if (d === undefined || typeof d.id !== "string" || d.id === "") return null;
  // The platform strips the "@bot" prefix but not the space it sat in.
  const content = typeof d.content === "string" ? d.content.trim() : "";
  if (frame.t === "C2C_MESSAGE_CREATE") {
    const openid = d.author?.user_openid;
    if (typeof openid !== "string" || openid === "") return null;
    return { kind: "c2c", openid, messageId: d.id, content, senderOpenid: openid };
  }
  if (frame.t === "GROUP_AT_MESSAGE_CREATE") {
    const openid = d.group_openid;
    if (typeof openid !== "string" || openid === "") return null;
    const sender = d.author?.member_openid;
    return {
      kind: "group",
      openid,
      messageId: d.id,
      content,
      ...(typeof sender === "string" && sender !== "" ? { senderOpenid: sender } : {}),
    };
  }
  return null;
}
