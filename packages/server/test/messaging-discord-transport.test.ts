/**
 * The Discord production adapter — the half of the channel that talks to Discord.
 *
 * messaging-discord.test.ts drives the connector and its routes over a fake transport,
 * which leaves everything under that seam unexercised: the REST calls with their
 * `Authorization: Bot` header and the platform's error envelope, the multipart upload, the
 * capped attachment download, and the gateway session's whole handshake / heartbeat /
 * resume protocol — where a platform failure actually reaches this product.
 *
 * Nothing here opens a socket or a connection. The REST calls go through the transport's
 * `fetch` seam, and the gateway runs on a fake socket passed through
 * `DiscordTransportOpts.createSocket` — test hooks rather than module mocks, because this
 * suite shares one module registry across files (see vitest.config.ts).
 */
import { describe, expect, it } from "vitest";
import type {
  DiscordCredentials,
  DiscordGatewayFrame,
  DiscordMessage,
  DiscordSocket,
} from "../src/runtime/messaging/discord-api.js";
import {
  DISCORD_API_BASE,
  DISCORD_INTENTS,
  DiscordApiError,
  createDiscordTransport,
  discordErrorText,
} from "../src/runtime/messaging/discord-api.js";
import { MessagingConnectionClosedError } from "../src/runtime/messaging/qq-api.js";
import { messagingErrorKind } from "../src/runtime/messaging/error-kind.js";
import { MessagingMediaTooLargeError } from "../src/runtime/messaging/media.js";
import { waitFor } from "./helpers.js";

const CREDS: DiscordCredentials = { botToken: "MTIzNDU2Nzg5MDEyMzQ1Njc4.GaBcDe.test-secret" };

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

interface Call {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
  contentType: string | null;
}

/** A fetch seam that records every call and answers with `answer`, or a default. */
function fetchOf(answer: (call: Call, index: number) => Response | null) {
  const calls: Call[] = [];
  const doFetch = (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers as Record<string, string> | undefined);
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body,
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
    };
    calls.push(call);
    const answered = answer(call, calls.length - 1);
    if (answered !== null) return answered;
    if (call.url.endsWith("/users/@me")) return jsonResponse({ id: "123", username: "penguin" });
    if (call.url.endsWith("/gateway/bot")) return jsonResponse({ url: "wss://gateway.example" });
    if (call.url.includes("/channels/")) return jsonResponse({ id: "m1" });
    throw new Error(`unexpected fetch: ${call.url}`);
  }) as unknown as NonNullable<Parameters<typeof createDiscordTransport>[0]>["fetch"];
  return { calls, doFetch: doFetch! };
}

const defaults = (): null => null;

class FakeSocket {
  readyState = 1;
  readonly sent: DiscordGatewayFrame[] = [];
  readonly closeCodes: Array<number | undefined> = [];
  autoAck = true;
  private readonly listeners = new Map<string, ((evt: never) => void)[]>();

  constructor(readonly url: string) {}

  addEventListener(type: "message", fn: (evt: { data: unknown }) => void): void;
  addEventListener(type: "error", fn: () => void): void;
  addEventListener(type: "close", fn: (evt: { code: number }) => void): void;
  addEventListener(type: string, fn: (evt: never) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as DiscordGatewayFrame;
    this.sent.push(frame);
    if (frame.op === OP_HEARTBEAT && this.autoAck) this.deliver({ op: OP_HEARTBEAT_ACK });
  }

  close(code?: number): void {
    this.closeCodes.push(code);
    this.readyState = 3;
  }

  deliver(frame: DiscordGatewayFrame): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  drop(code: number): void {
    this.readyState = 3;
    this.emit("close", { code });
  }

  frames(op: number): DiscordGatewayFrame[] {
    return this.sent.filter((f) => f.op === op);
  }

  private emit(type: string, evt: { data?: unknown; code?: number }): void {
    for (const fn of this.listeners.get(type) ?? []) (fn as (e: unknown) => void)(evt);
  }
}

interface Harness {
  sockets: FakeSocket[];
  inbound: DiscordMessage[];
  errors: unknown[];
  readonly readies: number;
  calls: Call[];
  open(): Promise<{ close(): void }>;
}

function harnessOf(opts: { handshakeTimeoutMs?: number; retryMs?: number } = {}): Harness {
  const sockets: FakeSocket[] = [];
  const inbound: DiscordMessage[] = [];
  const errors: unknown[] = [];
  const state = { readies: 0 };
  const { calls, doFetch } = fetchOf(defaults);
  const transport = createDiscordTransport({
    fetch: doFetch,
    gatewayRetryMs: () => opts.retryMs ?? 5,
    createSocket: (url): DiscordSocket => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    handshakeTimeoutMs: opts.handshakeTimeoutMs ?? 10_000,
  });
  return {
    sockets,
    inbound,
    errors,
    calls,
    get readies() {
      return state.readies;
    },
    async open() {
      const conn = await transport.openGateway(CREDS, {
        onMessage: (msg) => {
          inbound.push(msg);
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

/** HELLO → IDENTIFY → READY, the handshake every connected test starts from. */
function handshake(socket: FakeSocket, sessionId = "sess-1", intervalMs = 41_250): void {
  socket.deliver({ op: OP_HELLO, d: { heartbeat_interval: intervalMs } });
  socket.deliver({
    op: OP_DISPATCH,
    t: "READY",
    s: 1,
    d: { session_id: sessionId, resume_gateway_url: "wss://resume.example", user: { id: "123" } },
  });
}

describe("the Discord REST client", () => {
  it("probes with the Bot authorization and posts a reply with mentions suppressed", async () => {
    const { calls, doFetch } = fetchOf(defaults);
    const bot = createDiscordTransport({ fetch: doFetch }).createClient(CREDS);
    expect(await bot.getMe()).toEqual({ id: "123", username: "penguin" });
    expect(calls[0]!.authorization).toBe(`Bot ${CREDS.botToken}`);
    expect(calls[0]!.url).toBe(`${DISCORD_API_BASE}/users/@me`);

    await bot.sendMessage({ channelId: "c1", content: "hello", replyToMessageId: "m0" });
    const send = calls[1]!;
    expect(send.url).toBe(`${DISCORD_API_BASE}/channels/c1/messages`);
    expect(send.method).toBe("POST");
    expect(send.contentType).toBe("application/json");
    expect(JSON.parse(send.body as string)).toEqual({
      content: "hello",
      allowed_mentions: { parse: [] },
      message_reference: { message_id: "m0", fail_if_not_exists: false },
    });
  });

  it("uploads a file as multipart with the attachment named in payload_json", async () => {
    const { calls, doFetch } = fetchOf(defaults);
    const bot = createDiscordTransport({ fetch: doFetch }).createClient(CREDS);
    await bot.sendFile({ channelId: "c1", fileName: "chart.png", data: Buffer.from("png!") });
    const call = calls[0]!;
    // No hand-written content-type: fetch derives the multipart boundary from the body.
    expect(call.contentType).toBeNull();
    const form = call.body as FormData;
    expect(JSON.parse(String(form.get("payload_json")))).toEqual({
      attachments: [{ id: 0, filename: "chart.png" }],
      allowed_mentions: { parse: [] },
    });
    const file = form.get("files[0]") as File;
    expect(file.name).toBe("chart.png");
    expect(await file.text()).toBe("png!");
  });

  it("types a refusal as DiscordApiError with the platform's reason, and never echoes the token", async () => {
    const { doFetch } = fetchOf((call) =>
      call.url.includes("/channels/")
        ? jsonResponse({ code: 50013, message: "Missing Permissions" }, 403)
        : null,
    );
    const bot = createDiscordTransport({ fetch: doFetch }).createClient(CREDS);
    const err = await bot.sendMessage({ channelId: "c1", content: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiscordApiError);
    expect((err as DiscordApiError).status).toBe(403);
    expect((err as DiscordApiError).code).toBe(50013);
    expect(String(err)).toContain("Missing Permissions");
    expect(String(err)).toContain("lacks permission");
    expect(String(err)).not.toContain(CREDS.botToken);
  });

  it("leads the refusals an operator can act on with the action", () => {
    expect(discordErrorText(401, { message: "401: Unauthorized" })).toContain("token was rejected");
    expect(discordErrorText(429, { message: "rate limited", retry_after: 2.5 })).toContain(
      "retry after 2.5s",
    );
    expect(discordErrorText(403, { code: 50007, message: "Cannot send" })).toContain(
      "direct messages from bots",
    );
    expect(discordErrorText(413, { code: 40005, message: "Request entity too large" })).toContain(
      "larger than",
    );
    expect(discordErrorText(500, null)).toBe("HTTP 500");
  });

  it("downloads an attachment without the authorization header, refusing an oversized one", async () => {
    const { calls, doFetch } = fetchOf((call) => {
      if (!call.url.startsWith("https://cdn.example/")) return null;
      if (call.url.endsWith("big")) {
        return new Response("x".repeat(10), { status: 200, headers: { "content-length": "10" } });
      }
      return new Response("bytes", { status: 200 });
    });
    const bot = createDiscordTransport({ fetch: doFetch }).createClient(CREDS);
    const data = await bot.fetchAttachment({ url: "https://cdn.example/small", maxBytes: 100 });
    expect(data.toString()).toBe("bytes");
    // The CDN URL is pre-signed; sending the bot token to it would leak it for nothing.
    expect(calls[0]!.authorization).toBeNull();
    await expect(
      bot.fetchAttachment({ url: "https://cdn.example/big", maxBytes: 4, what: "The image" }),
    ).rejects.toBeInstanceOf(MessagingMediaTooLargeError);
  });
});

describe("the Discord gateway session", () => {
  it("looks the gateway up, identifies with the two message intents, and reports the handshake", async () => {
    const h = harnessOf();
    const conn = await h.open();
    try {
      const socket = h.sockets[0]!;
      expect(socket.url).toBe("wss://gateway.example?v=10&encoding=json");
      expect(h.calls.filter((c) => c.url.endsWith("/gateway/bot"))[0]!.authorization).toBe(
        `Bot ${CREDS.botToken}`,
      );
      socket.deliver({ op: OP_HELLO, d: { heartbeat_interval: 41_250 } });
      const identify = socket.frames(OP_IDENTIFY)[0]!;
      expect(identify.d).toMatchObject({ token: CREDS.botToken, intents: DISCORD_INTENTS });
      expect((identify.d as { properties: { browser: string } }).properties.browser).toBe(
        "penguin-harness",
      );
      expect(h.readies).toBe(0);
      handshake(socket);
      expect(h.readies).toBe(1);

      socket.deliver({
        op: OP_DISPATCH,
        t: "MESSAGE_CREATE",
        s: 2,
        d: {
          id: "m1",
          channel_id: "c1",
          author: { id: "u1", username: "ada" },
          content: "status?",
          type: 0,
        },
      });
      expect(h.inbound).toEqual([
        {
          id: "m1",
          channel_id: "c1",
          author: { id: "u1", username: "ada" },
          content: "status?",
          type: 0,
        },
      ]);
      // A frame that is not a message, and a message without an author, are both dropped.
      socket.deliver({ op: OP_DISPATCH, t: "TYPING_START", s: 3, d: { channel_id: "c1" } });
      socket.deliver({ op: OP_DISPATCH, t: "MESSAGE_CREATE", s: 4, d: { id: "m2" } });
      expect(h.inbound).toHaveLength(1);
    } finally {
      conn.close();
    }
  });

  it("resumes on the resume URL after a routine drop, and re-identifies after one that kills the session", async () => {
    const h = harnessOf();
    const conn = await h.open();
    try {
      handshake(h.sockets[0]!, "sess-1");
      h.sockets[0]!.drop(1001);
      await waitFor(() => h.sockets.length === 2);
      // The resume goes to READY's own URL, not the one the lookup answered.
      expect(h.sockets[1]!.url).toBe("wss://resume.example?v=10&encoding=json");
      h.sockets[1]!.deliver({ op: OP_HELLO, d: { heartbeat_interval: 41_250 } });
      expect(h.sockets[1]!.frames(OP_RESUME)[0]).toMatchObject({
        d: { token: CREDS.botToken, session_id: "sess-1", seq: 1 },
      });
      h.sockets[1]!.deliver({ op: OP_DISPATCH, t: "RESUMED", s: 2 });
      expect(h.readies).toBe(2);
      // One gateway lookup for both sockets.
      expect(h.calls.filter((c) => c.url.endsWith("/gateway/bot"))).toHaveLength(1);

      // 4009 says the session timed out: the next handshake starts over, on the lookup URL.
      h.sockets[1]!.drop(4009);
      await waitFor(() => h.sockets.length === 3);
      expect(h.sockets[2]!.url).toBe("wss://gateway.example?v=10&encoding=json");
      h.sockets[2]!.deliver({ op: OP_HELLO, d: { heartbeat_interval: 41_250 } });
      expect(h.sockets[2]!.frames(OP_RESUME)).toHaveLength(0);
      expect(h.sockets[2]!.frames(OP_IDENTIFY)).toHaveLength(1);
    } finally {
      conn.close();
    }
  });

  it("honours INVALID_SESSION's flag and reconnects on RECONNECT, closing with a resumable code", async () => {
    const h = harnessOf();
    const conn = await h.open();
    try {
      handshake(h.sockets[0]!, "sess-1");
      h.sockets[0]!.deliver({ op: OP_RECONNECT });
      // A client-initiated close must not be 1000/1001, which would invalidate the session.
      expect(h.sockets[0]!.closeCodes).toEqual([4200]);
      h.sockets[0]!.drop(4200);
      await waitFor(() => h.sockets.length === 2);
      h.sockets[1]!.deliver({ op: OP_HELLO, d: { heartbeat_interval: 41_250 } });
      expect(h.sockets[1]!.frames(OP_RESUME)).toHaveLength(1);

      // Resumable: the handle survives, the next socket resumes again.
      h.sockets[1]!.deliver({ op: OP_INVALID_SESSION, d: true });
      h.sockets[1]!.drop(4200);
      await waitFor(() => h.sockets.length === 3);
      h.sockets[2]!.deliver({ op: OP_HELLO, d: { heartbeat_interval: 41_250 } });
      expect(h.sockets[2]!.frames(OP_RESUME)).toHaveLength(1);

      // Not resumable: identify fresh.
      h.sockets[2]!.deliver({ op: OP_INVALID_SESSION, d: false });
      h.sockets[2]!.drop(4200);
      await waitFor(() => h.sockets.length === 4);
      h.sockets[3]!.deliver({ op: OP_HELLO, d: { heartbeat_interval: 41_250 } });
      expect(h.sockets[3]!.frames(OP_IDENTIFY)).toHaveLength(1);
    } finally {
      conn.close();
    }
  });

  it("stops for good on a rejected token or refused intents, naming the reason", async () => {
    for (const code of [4004, 4014]) {
      const h = harnessOf();
      const conn = await h.open();
      try {
        handshake(h.sockets[0]!);
        h.sockets[0]!.drop(code);
        await settle(40);
        expect(h.sockets).toHaveLength(1);
        expect(h.errors).toHaveLength(1);
        const err = h.errors[0] as MessagingConnectionClosedError;
        expect(err).toBeInstanceOf(MessagingConnectionClosedError);
        expect(err.closeCode).toBe(code);
        expect(err.recovers).toBe(false);
        expect(String(err)).toContain(code === 4004 ? "token was rejected" : "intents");
      } finally {
        conn.close();
      }
    }
  });

  it("types every close it reports, and the recorder files only the routine ones as expected", async () => {
    const verdictOf = async (code: number): Promise<MessagingConnectionClosedError> => {
      const h = harnessOf();
      const conn = await h.open();
      try {
        handshake(h.sockets[0]!);
        h.sockets[0]!.drop(code);
        await waitFor(() => h.errors.length > 0);
        return h.errors[0] as MessagingConnectionClosedError;
      } finally {
        conn.close();
      }
    };
    expect((await verdictOf(1000)).recovers).toBe(true);
    expect((await verdictOf(1001)).recovers).toBe(true);
    expect((await verdictOf(4000)).recovers).toBe(true);
    expect((await verdictOf(4007)).recovers).toBe(false);
    expect((await verdictOf(4009)).recovers).toBe(false);
    expect((await verdictOf(4004)).recovers).toBe(false);
    expect(messagingErrorKind(await verdictOf(1001), "messaging_connect_failed")).toBe("expected");
    expect(messagingErrorKind(await verdictOf(4004), "messaging_connect_failed")).toBe(
      "unexpected",
    );
  });

  it("answers a heartbeat request at once and drops a socket that stops acknowledging", async () => {
    const h = harnessOf();
    const conn = await h.open();
    try {
      const socket = h.sockets[0]!;
      handshake(socket, "sess-1", 20);
      socket.deliver({ op: OP_HEARTBEAT });
      expect(socket.frames(OP_HEARTBEAT).at(-1)).toMatchObject({ op: OP_HEARTBEAT, d: 1 });
      await settle(70);
      expect(socket.frames(OP_HEARTBEAT).length).toBeGreaterThanOrEqual(2);
      expect(socket.closeCodes).toHaveLength(0);

      socket.autoAck = false;
      await waitFor(() => h.sockets.length === 2);
      expect(socket.closeCodes).toEqual([4200]);
      expect(String(h.errors[0])).toContain("heartbeat");
    } finally {
      conn.close();
    }
  });

  it("drops a socket that never handshook, and stops opening sockets once closed", async () => {
    const h = harnessOf({ handshakeTimeoutMs: 30 });
    const conn = await h.open();
    await waitFor(() => h.sockets.length === 2);
    expect(String(h.errors[0])).toContain("handshake");
    handshake(h.sockets[1]!);
    conn.close();
    // The binding going dark on purpose closes normally, which may end the session.
    expect(h.sockets[1]!.closeCodes).toEqual([1000]);
    await settle(60);
    expect(h.sockets).toHaveLength(2);
  });

  it("reports a gateway lookup the platform refuses, with the reason", async () => {
    const sockets: FakeSocket[] = [];
    const errors: unknown[] = [];
    const { doFetch } = fetchOf((call) =>
      call.url.endsWith("/gateway/bot")
        ? jsonResponse({ message: "401: Unauthorized", code: 0 }, 401)
        : null,
    );
    const transport = createDiscordTransport({
      fetch: doFetch,
      gatewayRetryMs: () => 5,
      createSocket: (url): DiscordSocket => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    const conn = await transport.openGateway(CREDS, {
      onMessage: () => {},
      onError: (err) => {
        errors.push(err);
      },
    });
    try {
      await waitFor(() => errors.length > 0);
      expect(String(errors[0])).toContain("Gateway lookup failed");
      expect(String(errors[0])).toContain("token was rejected");
      expect(sockets).toHaveLength(0);
    } finally {
      conn.close();
    }
  });
});
