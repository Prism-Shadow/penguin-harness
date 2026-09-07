/**
 * The API socket client (api/socket.ts) against a scripted WebSocket: frames out, answers
 * in, streams that outlive the socket, the identity it settles by itself, and the fallback
 * when no socket is to be had.
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

/** The identity the scripted server reports; tests set it. */
let whoAmI: () => Promise<string | null>;
let asked = 0;

let socket: ApiSocket;
beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
  asked = 0;
  whoAmI = async () => "admin";
  socket = new ApiSocket(
    (userId) => `ws://test/socket/${userId}`,
    () => {
      asked += 1;
      return whoAmI();
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const last = () => FakeSocket.instances[FakeSocket.instances.length - 1]!;

/** Lets ready() settle the identity and open the scripted socket, then completes the handshake. */
async function openViaReady(s: ApiSocket = socket): Promise<Promise<boolean>> {
  const pending = s.ready();
  await Promise.resolve(); // the identity promise
  await Promise.resolve();
  last().open();
  return pending;
}

describe("calls", () => {
  it("is not open until the handshake completes, then frames a call and resolves its answer", async () => {
    expect(socket.isOpen()).toBe(false);
    await expect(socket.call("GET", "/api/me")).rejects.toThrow("socket_closed");
    await expect(openViaReady()).resolves.toBe(true);
    expect(socket.isOpen()).toBe(true);
    expect(last().url).toBe("ws://test/socket/admin"); // addressed by the identity it settled
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
    await openViaReady();
    const answer = socket.call("GET", "/api/me");
    last().drop();
    await expect(answer).rejects.toThrow("socket_closed");
    expect(socket.isOpen()).toBe(false);
  });
});

describe("identity", () => {
  it("asks who is signed in once, and never opens for nobody", async () => {
    whoAmI = async () => null;
    await expect(socket.ready()).resolves.toBe(false);
    await expect(socket.ready()).resolves.toBe(false);
    expect(asked).toBe(1); // remembered: nobody signed in
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("asks again when it could not tell", async () => {
    whoAmI = async () => {
      throw new Error("network");
    };
    await expect(socket.ready()).resolves.toBe(false);
    whoAmI = async () => "admin";
    await expect(openViaReady()).resolves.toBe(true);
    expect(asked).toBe(2);
  });

  it("takes the identity the API client saw, without asking", async () => {
    socket.identityIs("alice");
    await expect(openViaReady()).resolves.toBe(true);
    expect(asked).toBe(0);
    expect(last().url).toBe("ws://test/socket/alice");
  });

  it("closes on an identity change and opens the next user's on the next call", async () => {
    await openViaReady();
    const h = handlers();
    socket.stream("/api/events", h, () => ({ close: () => undefined }));
    socket.identityChanged();
    expect(socket.isOpen()).toBe(false);
    expect(h.errors).toEqual([false]); // the stream is parked, not dropped
    whoAmI = async () => "bob";
    vi.advanceTimersByTime(1_000); // the parked stream asks to reopen
    await Promise.resolve();
    await Promise.resolve();
    expect(last().url).toBe("ws://test/socket/bob");
  });
});

describe("streams", () => {
  it("issues the stream as a call, dispatches events by kind, and cancels on close", async () => {
    const h = handlers();
    const conn = socket.stream("/api/events", h, () => ({ close: () => undefined }));
    await Promise.resolve();
    await Promise.resolve();
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

  it("re-issues a stream after a drop with the last event id, on a fresh socket", async () => {
    const h = handlers();
    socket.stream("/api/sessions/s1/stream", h, () => ({ close: () => undefined }));
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    last().receive({ id: 1, status: 200, stream: true, headers: {} });
    last().receive({ id: 1, event: "message", eventId: "7-41", data: "{}" });
    last().drop();
    expect(h.errors).toEqual([false]);
    vi.advanceTimersByTime(1_000); // first backoff step
    await Promise.resolve();
    await Promise.resolve();
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

  it("re-issues a stream the server ended, and one answered 503, but not one refused", async () => {
    const h = handlers();
    socket.stream("/server/m1/api/events", h, () => ({ close: () => undefined }));
    await Promise.resolve();
    await Promise.resolve();
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

  it("falls back to the caller's EventSource after the handshake keeps failing", async () => {
    const fallbackCloses: number[] = [];
    let built = 0;
    const conn = socket.stream("/api/events", handlers(), () => {
      built += 1;
      return { close: () => fallbackCloses.push(1) };
    });
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      await Promise.resolve();
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
    await expect(socket.ready()).resolves.toBe(false);
    conn.close();
    expect(fallbackCloses).toEqual([1]);
  });
});

describe("ready", () => {
  it("waits for a handshake in progress and answers true once it completes", async () => {
    const first = socket.ready();
    await Promise.resolve();
    await Promise.resolve();
    const second = socket.ready(); // joins the same handshake
    expect(FakeSocket.instances).toHaveLength(1);
    last().open();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    await expect(socket.ready()).resolves.toBe(true); // already open: at once
  });

  it("answers false when the handshake fails, and without WebSocket support", async () => {
    const pending = socket.ready();
    await Promise.resolve();
    await Promise.resolve();
    last().drop();
    await expect(pending).resolves.toBe(false);
    vi.stubGlobal("WebSocket", undefined);
    const noWs = new ApiSocket(
      () => "ws://test/socket",
      async () => "admin",
    );
    await expect(noWs.ready()).resolves.toBe(false);
    expect(noWs.isUnavailable()).toBe(true);
  });
});

describe("robustness", () => {
  it("closes a socket that has gone silent for two beats and brings the streams back", async () => {
    const h = handlers();
    socket.stream("/api/events", h, () => ({ close: () => undefined }));
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    last().receive({ heartbeat: true }); // a heartbeat re-arms the watchdog and is otherwise ignored
    expect(h.errors).toEqual([]);
    vi.advanceTimersByTime(39_000);
    expect(socket.isOpen()).toBe(true);
    vi.advanceTimersByTime(2_000); // two beats of silence
    expect(socket.isOpen()).toBe(false);
    expect(h.errors).toEqual([false]); // parked, will be re-issued
    vi.advanceTimersByTime(1_000); // the reconnect backoff
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(socket.isUnavailable()).toBe(false); // a watchdog close is never a refusal
  });

  it("keeps trying a server that is down instead of giving the socket up", async () => {
    socket.stream("/api/events", handlers(), () => ({ close: () => undefined }));
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    last().drop(); // the server went away
    whoAmI = async () => {
      throw new Error("ECONNREFUSED");
    };
    // The first retry still tries the handshake on the remembered identity and fails; from
    // then on the server is probed over HTTP first, and no handshake is attempted while it
    // cannot be reached — however long that lasts.
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(2);
    last().drop();
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(FakeSocket.instances).toHaveLength(2);
    expect(socket.isUnavailable()).toBe(false);
    whoAmI = async () => "admin"; // the server is back
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(3);
    last().open();
    expect(socket.isOpen()).toBe(true);
  });

  it("closes a socket that turns out to be another user's", async () => {
    await openViaReady();
    expect(last().url).toBe("ws://test/socket/admin");
    socket.identityIs("admin"); // same user: nothing happens
    expect(socket.isOpen()).toBe(true);
    socket.identityIs("alice"); // the cookie changed under the tab
    expect(socket.isOpen()).toBe(false);
    expect(socket.isUnavailable()).toBe(false);
  });
});
