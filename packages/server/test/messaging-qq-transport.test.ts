/**
 * The QQ production adapter — the half of the channel that talks to Tencent.
 *
 * messaging-qq.test.ts drives the connector and its routes over a fake transport, which
 * leaves everything under that seam unexercised: the access-token cache, the OpenAPI POST
 * with its 401 replay and its two error families, and the gateway session's whole
 * handshake / heartbeat / reconnect protocol. Those are where a platform failure actually
 * reaches this product, so they get their own file.
 *
 * Nothing here opens a socket or a connection. `globalThis.fetch` is stubbed the way
 * messaging-telegram.test.ts stubs it, and the gateway runs on a fake socket passed through
 * `QQTransportOpts.createSocket` — a test hook rather than a module mock, because this
 * suite shares one module registry across files and `vi.mock` would leak into every later
 * one (see vitest.config.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  QQCredentials,
  QQGatewayFrame,
  QQInboundEvent,
  QQSocket,
} from "../src/runtime/messaging/qq-api.js";
import {
  QQ_API_BASE,
  QQ_INTENT_GROUP_AND_C2C,
  MessagingConnectionClosedError,
  QQApiError,
  createQQTransport,
} from "../src/runtime/messaging/qq-api.js";
import { waitFor } from "./helpers.js";

const CREDS: QQCredentials = { appId: "102000001", appSecret: "qq-app-secret-ABCD-1234" };

/** Gateway opcodes, spelled out here so a test asserts the wire number rather than a name. */
const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** One recorded request against the stubbed fetch. */
interface Call {
  url: string;
  method: string;
  body: string;
  authorization: string;
}

/**
 * Installs a fetch stub for the run of `body`, and hands it the calls it recorded.
 *
 * `answer` returns the response for one call; returning null means "the default", which is
 * a valid token and a gateway URL — the two calls almost every test needs before it reaches
 * the thing it is actually about.
 */
async function withFetch<T>(
  answer: (call: Call, index: number) => Response | null,
  body: (calls: Call[]) => Promise<T>,
): Promise<T> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      authorization: headers.get("authorization") ?? "",
    };
    calls.push(call);
    const answered = answer(call, calls.length - 1);
    if (answered !== null) return answered;
    if (call.url.endsWith("/app/getAppAccessToken")) {
      return jsonResponse({ access_token: `token-${calls.length}`, expires_in: 7200 });
    }
    if (call.url.endsWith("/gateway")) return jsonResponse({ url: "wss://gateway.example/ws" });
    if (call.url.includes("/v2/")) return jsonResponse({}, 200);
    throw new Error(`unexpected fetch: ${call.url}`);
  }) as typeof fetch;
  try {
    return await body(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** The default answer: let withFetch's own token/gateway responses stand. */
const defaults = (): null => null;

// ---------------------------------------------------------------------------
// A fake socket: every frame in and out is the test's, and no I/O happens.
// ---------------------------------------------------------------------------

class FakeSocket {
  /** WebSocket.OPEN; the session only ever writes into a socket in this state. */
  readyState = 1;
  readonly sent: QQGatewayFrame[] = [];
  closes = 0;
  /** Answer every heartbeat with HEARTBEAT_ACK, as a healthy gateway does. */
  autoAck = true;
  private readonly listeners = new Map<string, ((evt: never) => void)[]>();

  constructor(readonly url: string) {}

  // The seam's own three signatures, so the fake is assignable to QQSocket rather than
  // cast into it: a fake whose listener shape has drifted should not compile.
  addEventListener(type: "message", fn: (evt: { data: unknown }) => void): void;
  addEventListener(type: "error", fn: () => void): void;
  addEventListener(type: "close", fn: (evt: { code: number }) => void): void;
  addEventListener(type: string, fn: (evt: never) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as QQGatewayFrame;
    this.sent.push(frame);
    if (frame.op === OP_HEARTBEAT && this.autoAck) this.deliver({ op: OP_HEARTBEAT_ACK });
  }

  close(): void {
    this.closes += 1;
    this.readyState = 3;
  }

  /** Pushes one frame in, as a dispatch would. */
  deliver(frame: QQGatewayFrame): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  /** The far end closed with this code. */
  drop(code: number): void {
    this.readyState = 3;
    this.emit("close", { code });
  }

  /** The frames of one opcode, in order. */
  frames(op: number): QQGatewayFrame[] {
    return this.sent.filter((f) => f.op === op);
  }

  private emit(type: string, evt: { data?: unknown; code?: number }): void {
    for (const fn of this.listeners.get(type) ?? []) (fn as (e: unknown) => void)(evt);
  }
}

/** A gateway under test: the transport, the sockets it opened, and what it reported. */
interface Harness {
  sockets: FakeSocket[];
  inbound: QQInboundEvent[];
  errors: unknown[];
  readies: number;
  open(): Promise<{ close(): void }>;
}

function harnessOf(opts: { handshakeTimeoutMs?: number; retryMs?: number } = {}): Harness {
  const sockets: FakeSocket[] = [];
  const inbound: QQInboundEvent[] = [];
  const errors: unknown[] = [];
  const state = { readies: 0 };
  const transport = createQQTransport({
    gatewayRetryMs: () => opts.retryMs ?? 5,
    createSocket: (url): QQSocket => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    // Long enough that a test which is not about this deadline never trips it.
    handshakeTimeoutMs: opts.handshakeTimeoutMs ?? 10_000,
  });
  return {
    sockets,
    inbound,
    errors,
    get readies() {
      return state.readies;
    },
    async open() {
      const conn = await transport.openGateway(CREDS, {
        onMessage: (evt) => {
          inbound.push(evt);
        },
        onReady: () => {
          state.readies += 1;
        },
        onError: (err) => {
          errors.push(err);
        },
      });
      await waitFor(() => sockets.length > 0);
      return conn;
    },
  };
}

/** HELLO → (IDENTIFY | RESUME) → READY, the handshake every connected test starts from. */
function handshake(socket: FakeSocket, sessionId = "gw-session-1", intervalMs = 45_000): void {
  socket.deliver({ op: OP_HELLO, d: { heartbeat_interval: intervalMs } });
  socket.deliver({ op: OP_DISPATCH, t: "READY", s: 1, d: { session_id: sessionId } });
}

// ---------------------------------------------------------------------------

describe("the QQ access-token cache", () => {
  afterEach(() => vi.useRealTimers());

  it("buys one token and reuses it, whatever a burst of sends asks for", async () => {
    await withFetch(defaults, async (calls) => {
      const bot = createQQTransport().createClient(CREDS);
      // Concurrent, so the cache is asked before the first exchange has resolved: without
      // the in-flight collapse each of these buys its own token, and the endpoint answers
      // 100001 Too many requests.
      await Promise.all([bot.checkCredentials(), bot.checkCredentials(), bot.checkCredentials()]);
      await bot.checkCredentials();
      const exchanges = calls.filter((c) => c.url.endsWith("/app/getAppAccessToken"));
      expect(exchanges).toHaveLength(1);
      expect(exchanges[0]!.method).toBe("POST");
      // The exchange is the only call that carries the secret, and it carries it as the
      // platform's own field names.
      expect(JSON.parse(exchanges[0]!.body)).toEqual({
        appId: CREDS.appId,
        clientSecret: CREDS.appSecret,
      });
    });
  });

  it("re-buys once the token is inside its refresh margin", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withFetch(
      (call) =>
        call.url.endsWith("/app/getAppAccessToken")
          ? // Quoted, which is what the platform's own response example returns even though
            // its field table calls the field a number.
            jsonResponse({ access_token: `t${Date.now()}`, expires_in: "120" })
          : null,
      async (calls) => {
        const bot = createQQTransport().createClient(CREDS);
        await bot.checkCredentials();
        // Inside the cached life (120s less the documented 60s overlap).
        vi.setSystemTime(Date.now() + 30_000);
        await bot.checkCredentials();
        expect(calls).toHaveLength(1);
        // Past it. The old token stays valid for the overlap, so refreshing here can never
        // strand a request already in flight.
        vi.setSystemTime(Date.now() + 40_000);
        await bot.checkCredentials();
        expect(calls).toHaveLength(2);
      },
    );
  });

  it("caps a missing or nonsensical TTL at the platform's own ceiling instead of caching forever", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withFetch(
      (call) =>
        call.url.endsWith("/app/getAppAccessToken")
          ? jsonResponse({ access_token: "no-ttl" })
          : null,
      async (calls) => {
        const bot = createQQTransport().createClient(CREDS);
        await bot.checkCredentials();
        vi.setSystemTime(Date.now() + 7100 * 1000);
        await bot.checkCredentials();
        expect(calls).toHaveLength(1);
        vi.setSystemTime(Date.now() + 100 * 1000);
        await bot.checkCredentials();
        expect(calls).toHaveLength(2);
      },
    );
  });

  it("reports a refused exchange with the platform's reason and never with the secret", async () => {
    await withFetch(
      (call) =>
        call.url.endsWith("/app/getAppAccessToken")
          ? jsonResponse({ code: 100007, message: "appid invalid" }, 400)
          : null,
      async () => {
        const bot = createQQTransport().createClient(CREDS);
        const err = await bot.checkCredentials().then(
          () => "",
          (e: unknown) => (e instanceof Error ? e.message : String(e)),
        );
        expect(err).toContain("appid invalid");
        expect(err).toContain("100007");
        expect(err).not.toContain(CREDS.appSecret);
      },
    );
  });
});

describe("the QQ OpenAPI send", () => {
  const args = {
    kind: "c2c" as const,
    openid: "user_openid_aaa",
    content: "hello",
    msgId: "msg_1",
    msgSeq: 2,
  };

  it("posts a passive reply to the scene's own endpoint, as plain text", async () => {
    await withFetch(defaults, async (calls) => {
      const bot = createQQTransport().createClient(CREDS);
      await bot.sendMessage(args);
      await bot.sendMessage({ ...args, kind: "group", openid: "group_openid_bbb" });
      const sends = calls.filter((c) => c.url.includes("/v2/"));
      expect(sends.map((c) => c.url)).toEqual([
        `${QQ_API_BASE}/v2/users/user_openid_aaa/messages`,
        `${QQ_API_BASE}/v2/groups/group_openid_bbb/messages`,
      ]);
      expect(sends[0]!.authorization).toBe("QQBot token-1");
      expect(JSON.parse(sends[0]!.body)).toEqual({
        content: "hello",
        msg_type: 0,
        msg_id: "msg_1",
        msg_seq: 2,
      });
    });
  });

  it("posts a markdown reply as msg_type 2, with `content` emptied as the platform requires", async () => {
    await withFetch(defaults, async (calls) => {
      const bot = createQQTransport().createClient(CREDS);
      await bot.sendMessage({ ...args, markdown: "## Head\n\n**bold**" });
      const sent = calls.filter((c) => c.url.includes("/v2/"))[0]!;
      // "传了 markdown 后此字段必须为空" — a payload carrying both is rejected, so `content`
      // goes out empty rather than merely ignored. The deprecated template fields are absent.
      expect(JSON.parse(sent.body)).toEqual({
        content: "",
        msg_type: 2,
        markdown: { content: "## Head\n\n**bold**" },
        msg_id: "msg_1",
        msg_seq: 2,
      });
    });
  });

  it("types a refusal as QQApiError and a transfer failure as a plain Error", async () => {
    // The distinction the markdown-to-text fallback turns on: the platform answered and
    // delivered nothing, so another form of the same message is safe to send — where a
    // request that never completed may already have been delivered.
    await withFetch(
      (call) => (call.url.includes("/v2/") ? jsonResponse({ err_code: 40054001 }, 400) : null),
      async () => {
        const bot = createQQTransport().createClient(CREDS);
        const err = await bot.sendMessage(args).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(QQApiError);
        expect((err as QQApiError).code).toBe(40054001);
      },
    );
    await withFetch(
      (call) => {
        if (!call.url.includes("/v2/")) return null;
        throw new TypeError("fetch failed");
      },
      async () => {
        const bot = createQQTransport().createClient(CREDS);
        const err = await bot.sendMessage(args).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(QQApiError);
      },
    );
  });

  it("replays a 401 once on a fresh token, and gives up rather than looping", async () => {
    // A secret rotated in the console, or a clock further off than the refresh margin
    // covers: the cached token died before its stated expiry.
    await withFetch(
      (call) => (call.url.includes("/v2/") ? jsonResponse({ code: 11244 }, 401) : null),
      async (calls) => {
        const bot = createQQTransport().createClient(CREDS);
        await expect(bot.sendMessage(args)).rejects.toThrow(/Message send failed/);
        expect(calls.map((c) => c.url.replace(QQ_API_BASE, ""))).toEqual([
          "/app/getAppAccessToken",
          "/v2/users/user_openid_aaa/messages",
          // The invalidated cache buys a new token, and the send is tried once more...
          "/app/getAppAccessToken",
          "/v2/users/user_openid_aaa/messages",
        ]);
      },
    );
  });

  it("leads the one failure this product can provoke with the rule behind it", async () => {
    await withFetch(
      (call) =>
        call.url.includes("/v2/")
          ? // Both families in one body, which is where the precedence matters: the OpenAPI
            // answers `err_code` and the token endpoint answers `code`.
            jsonResponse({ err_code: 40034128, code: 500, message: "msg over limit" }, 400)
          : null,
      async () => {
        const bot = createQQTransport().createClient(CREDS);
        const err = await bot.sendMessage(args).then(
          () => "",
          (e: unknown) => (e instanceof Error ? e.message : String(e)),
        );
        expect(err).toContain("only a few replies");
        expect(err).toContain("40034128");
        expect(err).not.toContain("500");
      },
    );
  });
});

describe("the QQ gateway session", () => {
  it("identifies with the one subscribed intent and reports the handshake", async () => {
    await withFetch(defaults, async (calls) => {
      const h = harnessOf();
      const conn = await h.open();
      try {
        const socket = h.sockets[0]!;
        expect(socket.url).toBe("wss://gateway.example/ws");
        socket.deliver({ op: OP_HELLO, d: { heartbeat_interval: 45_000 } });
        expect(socket.frames(OP_IDENTIFY)[0]).toMatchObject({
          op: OP_IDENTIFY,
          d: { token: "QQBot token-1", intents: QQ_INTENT_GROUP_AND_C2C, shard: [0, 1] },
        });
        expect(h.readies).toBe(0); // HELLO is not a handshake; READY is
        socket.deliver({ op: OP_DISPATCH, t: "READY", s: 1, d: { session_id: "gw-1" } });
        expect(h.readies).toBe(1);

        socket.deliver({
          op: OP_DISPATCH,
          t: "C2C_MESSAGE_CREATE",
          s: 2,
          d: { id: "m1", content: " status?", author: { user_openid: "u1" } },
        });
        expect(h.inbound).toEqual([
          { kind: "c2c", openid: "u1", messageId: "m1", content: "status?", senderOpenid: "u1" },
        ]);
        // `GET /gateway` is rate limited to 2 requests a minute; one lookup per session.
        expect(calls.filter((c) => c.url.endsWith("/gateway"))).toHaveLength(1);
      } finally {
        conn.close();
      }
    });
  });

  it("resumes after a drop that keeps the session, and re-identifies after one that does not", async () => {
    await withFetch(defaults, async () => {
      const h = harnessOf();
      const conn = await h.open();
      try {
        handshake(h.sockets[0]!, "gw-1");
        // 4009 is the one drop the platform keeps resumable.
        h.sockets[0]!.drop(4009);
        await waitFor(() => h.sockets.length === 2);
        h.sockets[1]!.deliver({ op: OP_HELLO, d: { heartbeat_interval: 45_000 } });
        expect(h.sockets[1]!.frames(OP_RESUME)[0]).toMatchObject({
          d: { session_id: "gw-1", seq: 1 },
        });
        h.sockets[1]!.deliver({ op: OP_DISPATCH, t: "RESUMED", s: 2 });
        expect(h.readies).toBe(2);

        // 4006 says the handle is dead: the next handshake must start over.
        h.sockets[1]!.drop(4006);
        await waitFor(() => h.sockets.length === 3);
        h.sockets[2]!.deliver({ op: OP_HELLO, d: { heartbeat_interval: 45_000 } });
        expect(h.sockets[2]!.frames(OP_RESUME)).toHaveLength(0);
        expect(h.sockets[2]!.frames(OP_IDENTIFY)).toHaveLength(1);
        // One report per OUTAGE, and there were two: a completed handshake ends the first
        // one, so the drop after it is news rather than a repeat.
        expect(h.errors).toHaveLength(2);
      } finally {
        conn.close();
      }
    });
  });

  it("forgets the session on INVALID_SESSION and reconnects on RECONNECT", async () => {
    await withFetch(defaults, async () => {
      const h = harnessOf();
      const conn = await h.open();
      try {
        handshake(h.sockets[0]!, "gw-1");
        // Politely asked to reconnect: the session stays resumable.
        h.sockets[0]!.deliver({ op: OP_RECONNECT });
        expect(h.sockets[0]!.closes).toBe(1);
        h.sockets[0]!.drop(1000);
        await waitFor(() => h.sockets.length === 2);
        h.sockets[1]!.deliver({ op: OP_HELLO, d: { heartbeat_interval: 45_000 } });
        expect(h.sockets[1]!.frames(OP_RESUME)).toHaveLength(1);

        // The resume was refused: the handle goes.
        h.sockets[1]!.deliver({ op: OP_INVALID_SESSION });
        h.sockets[1]!.drop(1000);
        await waitFor(() => h.sockets.length === 3);
        h.sockets[2]!.deliver({ op: OP_HELLO, d: { heartbeat_interval: 45_000 } });
        expect(h.sockets[2]!.frames(OP_IDENTIFY)).toHaveLength(1);
      } finally {
        conn.close();
      }
    });
  });

  it("stops for good on a delisted or banned bot rather than retrying forever", async () => {
    await withFetch(defaults, async () => {
      const h = harnessOf();
      const conn = await h.open();
      try {
        handshake(h.sockets[0]!, "gw-1");
        h.sockets[0]!.drop(4914);
        await settle(40); // several backoff rounds at 5ms, had it retried
        expect(h.sockets).toHaveLength(1);
        expect(h.errors).toHaveLength(1);
        expect(String(h.errors[0])).toContain("4914");
      } finally {
        conn.close();
      }
    });
  });

  it("types every close it reports, and calls only the self-clearing ones recovering", async () => {
    // The dashboard's "needs a human" count is read off `recovers` (error-kind.ts), and the
    // reconnect decision behind it lives here — so the verdict is asserted at the socket
    // rather than on a hand-built error, which would only prove the classifier can read a
    // boolean somebody else typed in.
    const verdictOf = async (code: number): Promise<MessagingConnectionClosedError> => {
      let closed: MessagingConnectionClosedError | undefined;
      await withFetch(defaults, async () => {
        const h = harnessOf();
        const conn = await h.open();
        try {
          handshake(h.sockets[0]!, "gw-1");
          h.sockets[0]!.drop(code);
          await waitFor(() => h.errors.length > 0);
          const err = h.errors[0];
          expect(err).toBeInstanceOf(MessagingConnectionClosedError);
          closed = err as MessagingConnectionClosedError;
          expect(closed.closeCode).toBe(code);
        } finally {
          conn.close();
        }
      });
      return closed!;
    };

    // The platform expiring a long-lived connection, and its own internal-error band: the
    // session is back inside one backoff step with nothing changed anywhere.
    expect((await verdictOf(4009)).recovers).toBe(true);
    expect((await verdictOf(4900)).recovers).toBe(true);
    expect((await verdictOf(4913)).recovers).toBe(true);
    // A rejected token and an intent the bot was never granted reconnect just as eagerly and
    // meet the identical refusal every time, so retrying is not recovery.
    expect((await verdictOf(4004)).recovers).toBe(false);
    expect((await verdictOf(4014)).recovers).toBe(false);
    // A refused session handle recovers only by identifying fresh, which loses whatever
    // arrived in the gap; a delisted bot stops the session outright.
    expect((await verdictOf(4006)).recovers).toBe(false);
    expect((await verdictOf(4007)).recovers).toBe(false);
    expect((await verdictOf(4914)).recovers).toBe(false);
  });

  it("drops a socket that stops acknowledging heartbeats", async () => {
    await withFetch(defaults, async () => {
      const h = harnessOf();
      const conn = await h.open();
      try {
        const socket = h.sockets[0]!;
        handshake(socket, "gw-1", 20);
        // Healthy first: a socket that answers keeps its heartbeat going.
        await settle(70);
        expect(socket.frames(OP_HEARTBEAT).length).toBeGreaterThanOrEqual(2);
        expect(socket.closes).toBe(0);

        // Now the far end goes away without a FIN — a NAT or proxy drop. `readyState`
        // stays OPEN, so nothing but this watchdog can notice.
        socket.autoAck = false;
        await waitFor(() => h.sockets.length === 2);
        expect(socket.closes).toBe(1);
        expect(h.errors).toHaveLength(1);
        expect(String(h.errors[0])).toContain("heartbeat");
      } finally {
        conn.close();
      }
    });
  });

  it("drops a socket that opened and then never handshook", async () => {
    await withFetch(defaults, async () => {
      const h = harnessOf({ handshakeTimeoutMs: 30 });
      const conn = await h.open();
      try {
        // Not one frame: the shape of a proxy that accepted the upgrade and blackholed
        // everything after it. No HELLO means no heartbeat either, so the deadline on the
        // handshake is the only thing covering this.
        await waitFor(() => h.sockets.length === 2);
        expect(h.sockets[0]!.closes).toBe(1);
        expect(h.errors).toHaveLength(1);
        expect(String(h.errors[0])).toContain("handshake");
      } finally {
        conn.close();
      }
    });
  });

  it("stops opening sockets once the connection is closed", async () => {
    await withFetch(defaults, async () => {
      const h = harnessOf({ handshakeTimeoutMs: 20 });
      const conn = await h.open();
      handshake(h.sockets[0]!, "gw-1");
      conn.close();
      expect(h.sockets[0]!.closes).toBe(1);
      await settle(60);
      expect(h.sockets).toHaveLength(1);
    });
  });
});
