/**
 * The API socket client (api/socket.ts) against a scripted WebSocket: frames out, answers
 * in, streams that outlive the socket, and the fallback when no socket is to be had.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiSocket } from "../src/api/socket";
import type { StreamHandlers } from "../src/api/sse";

/** A WebSocket the test drives by hand. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.();
  }
  // test controls
  open() {
    this.onopen?.();
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop() {
    this.onclose?.();
  }
  frames(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const handlers = (): StreamHandlers & {
  omni: unknown[];
  server: unknown[];
  opens: number;
  errors: boolean[];
} => {
  const h = {
    omni: [] as unknown[],
    server: [] as unknown[],
    opens: 0,
    errors: [] as boolean[],
    onOmniMessage: (m: unknown) => h.omni.push(m),
    onServerEvent: (e: unknown) => h.server.push(e),
    onOpen: () => {
      h.opens += 1;
    },
    onError: (closed: boolean) => {
      h.errors.push(closed);
    },
  };
  return h as typeof h & StreamHandlers;
};

let socket: ApiSocket;
beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
  socket = new ApiSocket(() => "ws://test/api/socket");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const last = () => FakeSocket.instances[FakeSocket.instances.length - 1]!;

describe("calls", () => {
  it("is not open until the handshake completes, then frames a call and resolves its answer", async () => {
    expect(socket.isOpen()).toBe(false);
    await expect(socket.call("GET", "/api/me")).rejects.toThrow("socket_closed");
    socket.ensureOpen();
    last().open();
    expect(socket.isOpen()).toBe(true);
    const answer = socket.call("POST", "/api/x?y=1", { body: { a: 1 } });
    const frame = last().frames()[0]!;
    expect(frame).toEqual({ id: 1, call: { method: "POST", path: "/api/x?y=1", body: { a: 1 } } });
    last().receive({
      id: 1,
      status: 201,
      headers: { date: "Mon, 07 Sep 2026 00:00:00 GMT" },
      body: { ok: true },
    });
    await expect(answer).resolves.toEqual({
      status: 201,
      headers: { date: "Mon, 07 Sep 2026 00:00:00 GMT" },
      body: { ok: true },
    });
  });

  it("rejects calls in flight when the socket drops", async () => {
    socket.ensureOpen();
    last().open();
    const answer = socket.call("GET", "/api/me");
    last().drop();
    await expect(answer).rejects.toThrow("socket_closed");
    expect(socket.isOpen()).toBe(false);
  });
});

describe("streams", () => {
  it("issues the stream as a call, dispatches events by kind, and cancels on close", () => {
    const h = handlers();
    const conn = socket.stream("/api/events", h, () => ({ close: () => undefined }));
    last().open();
    const [issued] = last().frames();
    expect(issued).toEqual({
      id: 1,
      call: { method: "GET", path: "/api/events", headers: { accept: "text/event-stream" } },
    });
    last().receive({ id: 1, status: 200, stream: true, headers: {} });
    expect(h.opens).toBe(1);
    last().receive({ id: 1, event: "server_event", eventId: "1-1", data: '{"type":"hello"}' });
    last().receive({ id: 1, event: "message", eventId: "1-2", data: '{"kind":"m"}' });
    expect(h.server).toEqual([{ type: "hello" }]);
    expect(h.omni).toEqual([{ kind: "m" }]);
    conn.close();
    expect(last().frames()[1]).toEqual({ id: 1, cancel: true });
  });

  it("re-issues a stream after a drop with the last event id, on a fresh socket", () => {
    const h = handlers();
    socket.stream("/api/sessions/s1/stream", h, () => ({ close: () => undefined }));
    last().open();
    last().receive({ id: 1, status: 200, stream: true, headers: {} });
    last().receive({ id: 1, event: "message", eventId: "7-41", data: "{}" });
    last().drop();
    expect(h.errors).toEqual([false]);
    vi.advanceTimersByTime(1_000); // first backoff step
    expect(FakeSocket.instances).toHaveLength(2);
    last().open();
    expect(last().frames()[0]).toEqual({
      id: 2,
      call: {
        method: "GET",
        path: "/api/sessions/s1/stream",
        headers: { accept: "text/event-stream", "last-event-id": "7-41" },
      },
    });
    last().receive({ id: 2, status: 200, stream: true, headers: {} });
    expect(h.opens).toBe(2);
  });

  it("re-issues a stream the server ended, and one answered 503, but not one refused", () => {
    const h = handlers();
    socket.stream("/server/m1/api/events", h, () => ({ close: () => undefined }));
    last().open();
    last().receive({ id: 1, end: true, reason: "lagging" });
    vi.advanceTimersByTime(1_000);
    expect(last().frames()).toHaveLength(2);
    expect((last().frames()[1] as { id: number }).id).toBe(2);
    last().receive({ id: 2, status: 503, headers: {}, body: { error: { code: "not_connected" } } });
    expect(h.errors).toEqual([false, false]);
    vi.advanceTimersByTime(1_000);
    expect(last().frames()).toHaveLength(3);
    last().receive({ id: 3, status: 404, headers: {}, body: null });
    expect(h.errors).toEqual([false, false, true]);
    vi.advanceTimersByTime(60_000);
    expect(last().frames()).toHaveLength(3); // fatal: no further attempt
  });

  it("falls back to the caller's EventSource after the handshake keeps failing", () => {
    const fallbackCloses: number[] = [];
    let built = 0;
    const conn = socket.stream("/api/events", handlers(), () => {
      built += 1;
      return { close: () => fallbackCloses.push(1) };
    });
    for (let i = 0; i < 3; i++) {
      last().drop(); // closed before it ever opened: retried quickly, not on the drop backoff
      vi.advanceTimersByTime(250);
    }
    expect(socket.isUnavailable()).toBe(true);
    expect(built).toBe(1);
    // A later stream goes straight to the fallback, and calls are refused so fetch is used.
    socket.stream("/api/events", handlers(), () => {
      built += 1;
      return { close: () => undefined };
    });
    expect(built).toBe(2);
    expect(socket.isOpen()).toBe(false);
    conn.close();
    expect(fallbackCloses).toEqual([1]);
  });

  it("waits for a signed-in user before opening, and closes when the user changes", () => {
    let user: string | null = null;
    const addressed = new ApiSocket(() => (user === null ? null : `ws://test/socket/${user}`));
    const h = handlers();
    addressed.stream("/api/events", h, () => ({ close: () => undefined }));
    expect(FakeSocket.instances).toHaveLength(0); // nobody signed in: nothing to open
    user = "alice";
    addressed.ensureOpen();
    expect(last().url).toBe("ws://test/socket/alice");
    last().open();
    expect(addressed.isOpen()).toBe(true);
    expect(last().frames()).toHaveLength(1); // the waiting stream was issued on open
    addressed.userChanged();
    expect(addressed.isOpen()).toBe(false);
    expect(h.errors).toEqual([false]); // the stream is parked, not dropped
  });
});

describe("ready", () => {
  it("opens the socket and waits for the handshake, then answers true", async () => {
    const pending = socket.ready();
    expect(FakeSocket.instances).toHaveLength(1); // ready() opened it
    last().open();
    await expect(pending).resolves.toBe(true);
    await expect(socket.ready()).resolves.toBe(true); // already open: at once
  });

  it("answers false when the handshake fails, when nobody is signed in, and once given up", async () => {
    const pending = socket.ready();
    last().drop();
    await expect(pending).resolves.toBe(false);
    const unaddressed = new ApiSocket(() => null);
    await expect(unaddressed.ready()).resolves.toBe(false);
    vi.stubGlobal("WebSocket", undefined);
    const noWs = new ApiSocket(() => "ws://test/socket");
    await expect(noWs.ready()).resolves.toBe(false);
    expect(noWs.isUnavailable()).toBe(true);
  });
});
