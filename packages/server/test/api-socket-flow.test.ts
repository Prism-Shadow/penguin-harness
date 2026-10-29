/**
 * Acknowledged flow on the API socket (socket/serve.ts, socket/stream-answer.ts): a stream call
 * with `x-flow: credit` keeps at most its window of unacknowledged event data in flight.
 *
 * - Given a bulk stream with credit, no more than its window is ever unacknowledged, and it
 *   goes on as the client acknowledges.
 * - Given acknowledgements that arrive fast, the window grows past its start; given slow ones,
 *   it shrinks to its floor — it follows the measured delivery.
 * - Given a bulk stream waiting for credit, a one-shot call on the same socket is answered.
 * - Given a cancel while the route waits for credit, the wait rejects, the route's own cleanup
 *   runs, and no frame for that call follows.
 * - Given a stream without the header, every event goes at once, acks or not (as before).
 * - Given a stream that beats and has nothing to say, a `ping` goes out once per beat of quiet.
 * - Given a one-shot call cancelled while its body is still being read, no answer frame is sent
 *   (it used to be a 200 carrying whatever was read).
 *
 * The socket is a stand-in with the `ws` surface serveApiSocket uses; the routes are fetches.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { serveApiSocket } from "../src/socket/serve.js";
import type { StreamAnswer } from "../src/socket/stream-answer.js";

class StandInSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: Record<string, unknown>[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  ping() {}
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  terminate() {
    this.close();
  }
  frame(frame: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(frame)), false);
  }
  /** Event frames of one call, in order. */
  events(id: number): Array<{ event: string; data: string }> {
    return this.sent.filter((f) => f.id === id && "event" in f) as Array<{
      event: string;
      data: string;
    }>;
  }
}

const EVENT = "x".repeat(8 * 1024);
const flush = () => vi.advanceTimersByTimeAsync(0);
const streamCall = (id: number, path: string, flow: boolean) => ({
  id,
  call: {
    method: "GET",
    path,
    headers: { accept: "text/event-stream", ...(flow ? { "x-flow": "credit" } : {}) },
  },
});

/** A socket whose `/api/bulk` route sends `count` events of EVENT, each after `writable`. */
function bulkSocket(count: number) {
  const ws = new StandInSocket();
  const route = { released: false, waits: 0, answer: null as StreamAnswer | null };
  serveApiSocket(ws as unknown as WebSocket, {
    fetch: async () => Response.json({ ok: true }),
    fetchStream: async (_request, answer) => {
      route.answer = answer;
      answer.start(200, { "content-type": "text/event-stream" });
      void (async () => {
        try {
          for (let i = 0; i < count; i++) {
            route.waits += 1;
            await answer.writable(EVENT.length);
            answer.event("chunk", null, EVENT);
          }
          answer.end();
        } catch {
          // released: nothing more to send
        } finally {
          route.released = true;
        }
      })();
      return new Response(null, { status: 200 });
    },
    origin: "http://localhost:7364",
    log: () => undefined,
  });
  return { ws, route };
}

describe("acknowledged flow on the API socket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never has more than its window unacknowledged, and goes on as acks arrive", async () => {
    const { ws, route } = bulkSocket(40);
    ws.frame(streamCall(1, "/api/bulk", true));
    await flush();
    const window = 64 * 1024;
    expect(ws.events(1).length * EVENT.length).toBe(window);
    // Acks arrive in arbitrary steps; after each, what is in flight stays within the window.
    let acked = 0;
    while (ws.events(1).length < 40) {
      acked += 3 * EVENT.length;
      ws.frame({ id: 1, ack: Math.min(acked, ws.events(1).length * EVENT.length) });
      await flush();
      const sent = ws.events(1).length * EVENT.length;
      expect(sent - Math.min(acked, sent)).toBeLessThanOrEqual(window);
    }
    expect(ws.events(1)).toHaveLength(40);
    expect(route.released).toBe(true);
    ws.close();
  });

  it("the window follows the measured delivery: fast acks widen it, slow ones narrow it", async () => {
    const fast = bulkSocket(600);
    fast.ws.frame(streamCall(1, "/api/bulk", true));
    await flush();
    // Acknowledge everything every 100 ms: well over half a megabyte a second delivered.
    for (let step = 0; step < 5; step++) {
      await vi.advanceTimersByTimeAsync(100);
      fast.ws.frame({ id: 1, ack: fast.ws.events(1).length * EVENT.length });
      await flush();
    }
    const before = fast.ws.events(1).length;
    fast.ws.frame({ id: 1, ack: before * EVENT.length });
    await flush();
    const inFlight = (fast.ws.events(1).length - before) * EVENT.length;
    expect(inFlight).toBeGreaterThan(64 * 1024);
    fast.ws.close();

    const slow = bulkSocket(400);
    slow.ws.frame(streamCall(1, "/api/bulk", true));
    await flush();
    // Acknowledge one event a second: 8 KiB/s delivered.
    let acked = 0;
    for (let step = 0; step < 8; step++) {
      await vi.advanceTimersByTimeAsync(1000);
      acked += EVENT.length;
      slow.ws.frame({ id: 1, ack: acked });
      await flush();
    }
    const sentSlow = slow.ws.events(1).length * EVENT.length;
    expect(sentSlow - acked).toBeLessThanOrEqual(32 * 1024);
    slow.ws.close();
  });

  it("a one-shot call on the same socket is answered while a bulk stream waits for credit", async () => {
    const { ws } = bulkSocket(40);
    ws.frame(streamCall(1, "/api/bulk", true));
    await flush();
    ws.frame({ id: 2, call: { method: "GET", path: "/api/goal" } });
    await flush();
    expect(ws.sent.find((f) => f.id === 2)).toMatchObject({ status: 200, body: { ok: true } });
    ws.close();
  });

  it("a cancel while the route waits for credit rejects the wait and releases the route", async () => {
    const { ws, route } = bulkSocket(40);
    ws.frame(streamCall(1, "/api/bulk", true));
    await flush();
    const before = ws.sent.filter((f) => f.id === 1).length;
    expect(route.released).toBe(false);
    ws.frame({ id: 1, cancel: true });
    await flush();
    expect(route.released).toBe(true);
    ws.frame({ id: 1, ack: 1024 * 1024 });
    await flush();
    expect(ws.sent.filter((f) => f.id === 1)).toHaveLength(before);
    ws.close();
  });

  it("a stream without the header sends every event at once, as before", async () => {
    const { ws, route } = bulkSocket(40);
    ws.frame(streamCall(1, "/api/bulk", false));
    await flush();
    expect(ws.events(1)).toHaveLength(40);
    expect(ws.sent.find((f) => f.id === 1 && "end" in f)).toBeDefined();
    expect(route.released).toBe(true);
    ws.close();
  });

  it("a beating stream with nothing to say sends a ping once per beat of quiet", async () => {
    const ws = new StandInSocket();
    serveApiSocket(ws as unknown as WebSocket, {
      fetch: async () => Response.json({}),
      fetchStream: async (_request, answer) => {
        answer.start(200, { "content-type": "text/event-stream" });
        answer.beat(5_000);
        answer.event("window", null, "{}");
        return new Response(null, { status: 200 });
      },
      origin: "http://localhost:7364",
      log: () => undefined,
    });
    ws.frame(streamCall(1, "/api/history-lines", true));
    await flush();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(ws.events(1).map((e) => e.event)).toEqual(["window"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ws.events(1).map((e) => e.event)).toEqual(["window", "ping"]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ws.events(1).map((e) => e.event)).toEqual(["window", "ping", "ping"]);
    ws.frame({ id: 1, cancel: true });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ws.events(1)).toHaveLength(3);
    ws.close();
  });

  it("a one-shot call cancelled while its body is read gets no answer frame", async () => {
    const ws = new StandInSocket();
    let finish: () => void = () => {};
    serveApiSocket(ws as unknown as WebSocket, {
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              finish = () => {
                controller.enqueue(new TextEncoder().encode('{"messages":[]}'));
                controller.close();
              };
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      fetchStream: () => {
        throw new Error("no stream call is made here");
      },
      origin: "http://localhost:7364",
      log: () => undefined,
    });
    ws.frame({ id: 7, call: { method: "GET", path: "/server/m1/api/sessions/s/messages" } });
    await flush();
    ws.frame({ id: 7, cancel: true });
    finish();
    await flush();
    expect(ws.sent.filter((f) => f.id === 7)).toEqual([]);
    ws.close();
  });
});
