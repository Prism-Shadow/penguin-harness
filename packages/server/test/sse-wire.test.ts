/**
 * The SSE streams over a real socket: the app served by @hono/node-server, read by a plain
 * Node HTTP client that can stop reading, the way a dead or stuck peer does.
 *
 * - Given a subscriber whose peer stopped reading, when its writes have been parked on the
 *   full socket for 30 s, the server destroys the connection and drops the subscription
 *   (at 25 s it still holds both), and the peer, reading again, finds the stream ended —
 *   which is what sends an EventSource to reconnect.
 * - Given a peer that stalls and catches up again before the timeout, the connection is
 *   kept, and the timeout counts afresh from its next stall.
 * - A subscription gets a `ping` event right after its initial events and on every
 *   heartbeat; a ping carries `data: {}` and no id, so the next event's id follows on from
 *   the last one.
 * - A last event id in the `lastEventId` query parameter replays exactly as the
 *   `Last-Event-ID` header does, on the Session stream and on the user stream.
 * - A `lastEventId` the buffer no longer holds gets `resync_required`, then the snapshot.
 * - Sent both, the header wins: a browser reconnecting an EventSource the page reopened
 *   sends a header newer than the id in its URL.
 */
import http from "node:http";
import type net from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { userText } from "@prismshadow/penguin-core";
import type { Channel } from "../src/runtime/channel.js";
import { sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

interface Frame {
  event?: string;
  id?: string;
  data: string;
}

/** One open stream as the peer sees it. */
interface Peer {
  status: number;
  /** Frames received so far (comment lines skipped). */
  frames: Frame[];
  /** The socket was closed, by either end. */
  closed: () => boolean;
  /** Stop reading: the peer's buffers fill, then the server's. */
  stopReading: () => void;
  resumeReading: () => void;
  end: () => void;
}

const USER = "wire";
let t: TestApp;
let cookie: string;
let port: number;
let server: ReturnType<typeof serve>;
/** The server side of every accepted connection, newest last. */
const accepted: net.Socket[] = [];

beforeAll(async () => {
  t = await createTestApp();
  ({ cookie } = await provisionUser(t.app, USER));
  await new Promise<void>((resolve) => {
    server = serve({ fetch: t.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      port = info.port;
      resolve();
    });
  });
  server.on("connection", (socket: net.Socket) => accepted.push(socket));
});
afterAll(async () => {
  (server as http.Server).closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await t.cleanup();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Real time, whatever the fake clock is doing. */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls in real time; independent of a faked `Date`. */
async function until(cond: () => boolean, what: string, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await pause(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Opens `path` on a fresh connection, as the app's canonical host. */
async function connect(path: string, headers: Record<string, string> = {}): Promise<Peer> {
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    http
      .get(
        {
          host: "127.0.0.1",
          port,
          path,
          agent: false,
          headers: { host: `localhost:${port}`, cookie, accept: "text/event-stream", ...headers },
        },
        resolve,
      )
      .on("error", reject);
  });
  const frames: Frame[] = [];
  let buffer = "";
  let closed = false;
  res.socket.on("close", () => (closed = true));
  res.setEncoding("utf8");
  res.on("data", (chunk: string) => {
    buffer += chunk;
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      if (raw.startsWith(":")) continue;
      const frame: Frame = { data: "" };
      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) frame.event = line.slice(7);
        else if (line.startsWith("id: ")) frame.id = line.slice(4);
        else if (line.startsWith("data: ")) frame.data += line.slice(6);
      }
      frames.push(frame);
    }
  });
  res.on("error", () => undefined);
  return {
    status: res.statusCode ?? 0,
    frames,
    closed: () => closed,
    stopReading: () => {
      res.pause();
      res.socket.pause();
    },
    resumeReading: () => {
      res.socket.resume();
      res.resume();
    },
    end: () => res.destroy(),
  };
}

/** A Session of the test user, and its channel. */
function newSession() {
  const sessionId = uniqueSessionId();
  t.deps.sessionsRepo.insert(sessionRow(sessionId, { projectId: `${USER}-default_project` }));
  return { sessionId, channel: t.deps.channels.get(sessionId) };
}

/**
 * Publishes large events until the server's side of `socket` is parked: Node wants `drain`
 * and nothing more leaves. How much that takes is the two ends' socket buffers, which
 * differ by platform.
 */
async function parkWrites(channel: Channel, socket: net.Socket) {
  const body = "x".repeat(64 * 1024);
  let written = -1;
  for (let round = 0; round < 200; round++) {
    for (let i = 0; i < 16; i++) channel.publish(userText(body));
    await pause(50);
    if (socket.writableNeedDrain && socket.bytesWritten === written) return;
    written = socket.bytesWritten;
  }
  throw new Error("the server's writes never parked");
}

const textOf = (frame: Frame) =>
  (JSON.parse(frame.data) as { payload: { text: string } }).payload.text;

describe("a peer that stops reading", () => {
  it("is cut off once its writes have been parked for 30 s, and its subscription is dropped", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { sessionId, channel } = newSession();
    const peer = await connect(`/api/sessions/${sessionId}/stream`);
    await until(() => peer.frames.some((f) => f.event === "ping"), "the first ping");
    const socket = accepted.at(-1)!;
    expect(channel.subscriberCount).toBe(1);

    peer.stopReading();
    await parkWrites(channel, socket);

    vi.advanceTimersByTime(25_000);
    await pause(100);
    expect(peer.closed()).toBe(false);
    expect(channel.subscriberCount).toBe(1);

    vi.advanceTimersByTime(15_000);
    await until(() => socket.destroyed, "the server to destroy the connection");
    await until(() => channel.subscriberCount === 0, "the subscription to be dropped");

    // What was already in flight drains, then the stream ends.
    peer.resumeReading();
    await until(() => peer.closed(), "the peer to see the stream end", 3000);
  });

  it("is kept when it catches up before the timeout, and the timeout starts over at its next stall", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { sessionId, channel } = newSession();
    const peer = await connect(`/api/sessions/${sessionId}/stream`);
    await until(() => peer.frames.some((f) => f.event === "ping"), "the first ping");
    const socket = accepted.at(-1)!;

    peer.stopReading();
    await parkWrites(channel, socket);
    vi.advanceTimersByTime(25_000);

    // Reads everything, up to a marker published behind the backlog.
    peer.resumeReading();
    channel.publish(userText("caught-up"));
    await until(
      () => peer.frames.some((f) => f.data.includes("caught-up")),
      "the peer to catch up",
      3000,
    );
    peer.stopReading();
    await parkWrites(channel, socket);
    // 50 s since the first stall began; 25 s into this one.
    vi.advanceTimersByTime(25_000);
    await pause(100);
    expect(peer.closed()).toBe(false);
    expect(channel.subscriberCount).toBe(1);
    peer.end();
    await until(() => channel.subscriberCount === 0, "the subscription to be dropped");
  });
});

describe("heartbeats", () => {
  it("are id-less ping events: one right after the initial events, then one per beat", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { sessionId, channel } = newSession();
    const peer = await connect(`/api/sessions/${sessionId}/stream`);
    await until(() => peer.frames.length >= 2, "the initial frames");
    const [snapshot, ping] = peer.frames;
    expect(JSON.parse(snapshot!.data)).toMatchObject({ type: "task_state" });
    expect(ping).toEqual({ event: "ping", data: "{}" });

    vi.advanceTimersByTime(20_000);
    await until(() => peer.frames.length >= 3, "the next beat");
    expect(peer.frames[2]).toEqual({ event: "ping", data: "{}" });

    // The pings took no ids: the next event follows on from the snapshot's.
    channel.publish(userText("after the pings"));
    await until(() => peer.frames.length >= 4, "the next event");
    const seq = (id: string) => Number(id.slice(id.lastIndexOf("-") + 1));
    expect(seq(peer.frames[3]!.id!)).toBe(seq(snapshot!.id!) + 1);
    peer.end();
  });
});

describe("resuming from a last event id", () => {
  const streams = [
    {
      name: "Session stream",
      open: () => {
        const { sessionId, channel } = newSession();
        return { path: `/api/sessions/${sessionId}/stream`, channel, snapshot: "task_state" };
      },
    },
    {
      name: "user stream",
      open: () => ({
        path: "/api/events",
        channel: t.deps.channels.get(`user:${USER}`),
        snapshot: "hello",
      }),
    },
  ];
  const carriers = [
    {
      carrier: "Last-Event-ID header",
      send: (id: string) => ({ headers: { "Last-Event-ID": id } }),
    },
    {
      carrier: "lastEventId query parameter",
      send: (id: string) => ({ query: `?lastEventId=${encodeURIComponent(id)}` }),
    },
  ];
  const cases = streams.flatMap((s) => carriers.map((c) => ({ ...s, ...c })));

  it.each(cases)(
    "$name: the $carrier replays the events after it, then the initial events",
    async ({ open, send }) => {
      const { path, channel, snapshot } = open();
      const first = channel.publish(userText("m1"));
      channel.publish(userText("m2"));
      channel.publish(userText("m3"));
      const how = send(first.id) as { headers?: Record<string, string>; query?: string };
      const peer = await connect(`${path}${how.query ?? ""}`, how.headers);
      await until(() => peer.frames.length >= 3, "the replay");
      expect(textOf(peer.frames[0]!)).toBe("m2");
      expect(textOf(peer.frames[1]!)).toBe("m3");
      expect(JSON.parse(peer.frames[2]!.data)).toMatchObject({ type: snapshot });
      peer.end();
    },
  );

  it("a lastEventId the buffer no longer holds gets resync_required, then the snapshot", async () => {
    const { sessionId } = newSession();
    const peer = await connect(`/api/sessions/${sessionId}/stream?lastEventId=deadbeef-1`);
    await until(() => peer.frames.length >= 2, "the first frames");
    expect(JSON.parse(peer.frames[0]!.data)).toEqual({ type: "resync_required" });
    expect(JSON.parse(peer.frames[1]!.data)).toMatchObject({ type: "task_state" });
    peer.end();
  });

  it("sent both, the header wins over the query parameter", async () => {
    const { sessionId, channel } = newSession();
    const older = channel.publish(userText("m1"));
    const newer = channel.publish(userText("m2"));
    channel.publish(userText("m3"));
    const peer = await connect(
      `/api/sessions/${sessionId}/stream?lastEventId=${encodeURIComponent(older.id)}`,
      { "Last-Event-ID": newer.id },
    );
    await until(() => peer.frames.length >= 2, "the replay");
    expect(textOf(peer.frames[0]!)).toBe("m3");
    expect(JSON.parse(peer.frames[1]!.data)).toMatchObject({ type: "task_state" });
    peer.end();
  });
});
