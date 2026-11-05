/**
 * The API socket client (api/socket.ts) against a scripted WebSocket: frames out, answers
 * in, streams that outlive the socket, the identity it settles by itself, and a socket that
 * is retried on the backoff however often its handshake fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiSocket, SocketTimeoutError } from "../src/api/socket";
import type { StreamConnection, StreamHandlers } from "../src/api/sse";
import { FakeSocket } from "./fake-socket";

const handlers = (): StreamHandlers & {
  records: unknown[];
  server: unknown[];
  opens: number;
  errors: boolean[];
} => {
  const h = {
    records: [] as unknown[],
    server: [] as unknown[],
    opens: 0,
    errors: [] as boolean[],
    onRecord: (m: unknown) => h.records.push(m),
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

/** Runs the microtasks a step of ready(), onopen or a rejection queued up (fake timers leave them alone). */
async function settle(steps = 6): Promise<void> {
  for (let i = 0; i < steps; i++) await Promise.resolve();
}

describe("calls", () => {
  it("is not open until the handshake completes, then frames a call and resolves its answer", async () => {
    expect(socket.isOpen()).toBe(false);
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

  it("holds a call made before the socket is open, and sends it once the handshake completes", async () => {
    // The call is what opens the socket: it asks for one and waits in order, rather than
    // failing so that apiFetch would fetch beside the socket (the second transport this
    // client no longer has).
    const answer = socket.call("GET", "/api/projects");
    expect(socket.report().pendingCalls).toEqual(["GET /api/projects (waiting for the socket)"]);
    await Promise.resolve(); // the identity promise
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().frames()).toEqual([]); // nothing goes out before the handshake
    last().open();
    expect(socket.report().pendingCalls).toEqual(["GET /api/projects"]);
    expect(last().frames()).toEqual([{ id: 1, call: { method: "GET", path: "/api/projects" } }]);
    last().receive({ id: 1, status: 200, headers: {}, body: { projects: [] } });
    await expect(answer).resolves.toEqual({ status: 200, headers: {}, body: { projects: [] } });
  });

  it("keeps a call through a handshake that never opened, and sends it on the one that does", async () => {
    const answer = socket.call("GET", "/api/projects");
    await Promise.resolve();
    await Promise.resolve();
    last().drop(); // e.g. a proxy that refuses the upgrade: the call is not the casualty
    await Promise.resolve();
    expect(socket.report().pendingCalls).toEqual(["GET /api/projects (waiting for the socket)"]);
    vi.advanceTimersByTime(1_000); // the reconnect ladder
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(2);
    last().open();
    expect(last().frames()).toEqual([{ id: 1, call: { method: "GET", path: "/api/projects" } }]);
    last().receive({ id: 1, status: 200, headers: {}, body: { projects: [] } });
    await expect(answer).resolves.toEqual({ status: 200, headers: {}, body: { projects: [] } });
  });

  it("refuses a call when there is no socket to be had, instead of carrying it elsewhere", async () => {
    vi.stubGlobal("WebSocket", undefined);
    const noWs = new ApiSocket(
      () => "ws://test/socket",
      async () => "admin",
    );
    await expect(noWs.call("GET", "/api/projects")).rejects.toThrow("socket_closed");
    whoAmI = async () => null;
    await expect(socket.call("GET", "/api/projects")).rejects.toThrow("socket_closed");
  });

  it("rejects calls in flight when the socket drops", async () => {
    await openViaReady();
    const answer = socket.call("GET", "/api/me");
    last().drop();
    await expect(answer).rejects.toThrow("socket_closed");
    expect(socket.isOpen()).toBe(false);
  });

  it("sends two or more queued calls in the order they were made, every answer reaching its own caller", async () => {
    const first = socket.call("GET", "/api/a");
    const second = socket.call("POST", "/api/b", { body: { n: 2 } });
    const third = socket.call("GET", "/api/c");
    await settle();
    expect(FakeSocket.instances).toHaveLength(1);
    last().open();
    expect(last().frames()).toEqual([
      { id: 1, call: { method: "GET", path: "/api/a" } },
      { id: 2, call: { method: "POST", path: "/api/b", body: { n: 2 } } },
      { id: 3, call: { method: "GET", path: "/api/c" } },
    ]);
    // Answered out of order: the frame's id, not the answer's arrival, is what matches a call.
    last().receive({ id: 3, status: 200, headers: {}, body: "c" });
    last().receive({ id: 1, status: 200, headers: {}, body: "a" });
    last().receive({ id: 2, status: 201, headers: {}, body: "b" });
    await expect(first).resolves.toEqual({ status: 200, headers: {}, body: "a" });
    await expect(second).resolves.toEqual({ status: 201, headers: {}, body: "b" });
    await expect(third).resolves.toEqual({ status: 200, headers: {}, body: "c" });
  });

  it("refuses every call waiting for a handshake when nobody is signed in", async () => {
    whoAmI = async () => null;
    const answers = [
      socket.call("GET", "/api/a"),
      socket.call("POST", "/api/b", { body: { n: 2 } }),
      socket.call("GET", "/api/c"),
    ];
    const settled = await Promise.allSettled(answers);
    expect(settled.map((s) => s.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(settled.map((s) => (s as PromiseRejectedResult).reason.message)).toEqual([
      "socket_closed",
      "socket_closed",
      "socket_closed",
    ]);
    expect(FakeSocket.instances).toHaveLength(0); // nobody to open for
    expect(socket.report().pendingCalls).toEqual([]);
  });

  it("refuses every call waiting for a handshake when the page has no WebSocket", async () => {
    const noWs = new ApiSocket(
      () => "ws://test/socket",
      async () => "admin",
      false,
    );
    const answers = [
      noWs.call("GET", "/api/a"),
      noWs.call("GET", "/api/b"),
      noWs.call("GET", "/api/c"),
    ];
    const settled = await Promise.allSettled(answers);
    expect(settled.map((s) => s.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(settled.map((s) => (s as PromiseRejectedResult).reason.message)).toEqual([
      "socket_closed",
      "socket_closed",
      "socket_closed",
    ]);
    expect(noWs.report().pendingCalls).toEqual([]);
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
    socket.stream("/api/events", h);
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

describe("identity boundary of the queue", () => {
  it("never sends a call queued under one identity on the next identity's socket", async () => {
    await openViaReady(); // settled as admin
    const h = handlers();
    socket.stream("/api/events", h);
    last().receive({ id: 1, status: 200, stream: true, headers: {} });
    last().drop(); // the stream is parked, so the next handshake is already on the backoff
    const post = socket.call("POST", "/api/admin-only", { body: { name: "secret" } });
    expect(socket.report().pendingCalls).toEqual(["POST /api/admin-only (waiting for the socket)"]);

    // The admin signed out and bob signed in: the POST was the admin's, and it never goes out
    // under bob's authorization.
    whoAmI = async () => "bob";
    socket.identityChanged();
    await expect(post).rejects.toThrow("identity_changed");

    const bobCall = socket.call("GET", "/api/projects");
    vi.advanceTimersByTime(1_000); // the reconnect the drop scheduled
    await settle();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(last().url).toBe("ws://test/socket/bob");
    last().open();
    // Bob's own call and the stream, in that order — and nothing of the admin's.
    expect(last().frames()).toEqual([
      { id: 2, call: { method: "GET", path: "/api/projects" } },
      {
        id: 3,
        call: { method: "GET", path: "/api/events", headers: { accept: "text/event-stream" } },
      },
    ]);
    last().receive({ id: 2, status: 200, headers: {}, body: { projects: [] } });
    await expect(bobCall).resolves.toEqual({ status: 200, headers: {}, body: { projects: [] } });
  });

  it("revokes the queue when a /api/me answer names another user than the last one", async () => {
    await openViaReady(); // settled as admin
    socket.stream("/api/events", handlers());
    last().drop(); // something to carry keeps the reconnect scheduled
    const write = socket.call("POST", "/api/admin-only", { body: { name: "secret" } });
    socket.identityIs("bob"); // the cookie was replaced under this tab
    await expect(write).rejects.toThrow("identity_changed");
    expect(socket.report().pendingCalls).toEqual([]);
  });

  it("keeps the queue when the same user is confirmed again", async () => {
    await openViaReady(); // settled as admin
    socket.stream("/api/events", handlers());
    last().drop();
    const answer = socket.call("GET", "/api/projects");
    socket.identityIs("admin"); // same user: nothing the queue was made under has moved
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(FakeSocket.instances).toHaveLength(2);
    last().open();
    expect(last().frames()[0]).toEqual({ id: 2, call: { method: "GET", path: "/api/projects" } });
    last().receive({ id: 2, status: 200, headers: {}, body: { projects: [] } });
    await expect(answer).resolves.toEqual({ status: 200, headers: {}, body: { projects: [] } });
  });

  it("does not open a socket for a whoAmI answer the identity has already moved past", async () => {
    let answer: ((userId: string | null) => void) | undefined;
    let askedTimes = 0;
    whoAmI = () => {
      askedTimes += 1;
      if (askedTimes === 1)
        return new Promise<string | null>((resolve) => {
          answer = resolve;
        });
      return Promise.resolve("bob");
    };
    const ready = socket.ready();
    expect(askedTimes).toBe(1); // the probe is in flight
    socket.identityChanged(); // a sign-out lands while it is in flight
    answer!("alice"); // the stale answer names the user the page was
    await settle();
    // The stale answer opened nothing: the identity is asked again, and the socket is bob's.
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().url).toBe("ws://test/socket/bob");
    last().open();
    await expect(ready).resolves.toBe(true);
    expect(askedTimes).toBe(2);
  });
});

describe("reconnect backoff", () => {
  it("holds calls in the wait for the scheduled reconnect instead of opening one per call", async () => {
    await openViaReady();
    socket.stream("/api/events", handlers()); // what a page always has: something to carry
    last().drop(); // the drop schedules the next attempt
    const answers = [
      socket.call("GET", "/api/a"),
      socket.call("GET", "/api/b"),
      socket.call("POST", "/api/c", { body: { n: 3 } }),
    ];
    vi.advanceTimersByTime(999);
    await settle();
    expect(FakeSocket.instances).toHaveLength(1); // nothing before the backoff is up
    vi.advanceTimersByTime(1);
    await settle();
    expect(FakeSocket.instances).toHaveLength(2); // exactly one handshake, when the ladder says so
    last().open();
    expect(
      last()
        .frames()
        .map((f) => (f as { call: { path: string } }).call.path),
    ).toEqual(["/api/a", "/api/b", "/api/c", "/api/events"]);
    for (const [i, body] of ["a", "b", "c"].entries()) {
      last().receive({ id: i + 2, status: 200, headers: {}, body });
    }
    await expect(answers[0]).resolves.toEqual({ status: 200, headers: {}, body: "a" });
    await expect(answers[1]).resolves.toEqual({ status: 200, headers: {}, body: "b" });
    await expect(answers[2]).resolves.toEqual({ status: 200, headers: {}, body: "c" });
  });

  it("keeps the same timetable when more calls arrive during the wait", async () => {
    await openViaReady();
    socket.stream("/api/events", handlers());
    last().drop(); // the first step is 1 s out
    vi.advanceTimersByTime(400);
    socket.call("GET", "/api/a");
    vi.advanceTimersByTime(400); // t = 800 ms
    socket.call("GET", "/api/b");
    vi.advanceTimersByTime(199); // t = 999 ms
    await settle();
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1); // t = 1000 ms: the drop's own step, not 400 ms after the last call
    await settle();
    expect(FakeSocket.instances).toHaveLength(2);
  });
});

describe("streams", () => {
  it("issues the stream as a call, dispatches events by kind, and cancels on close", async () => {
    const h = handlers();
    const conn = socket.stream("/api/events", h);
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
    expect(h.records).toEqual([{ kind: "m" }]);
    conn.close();
    expect(last().frames()[1]).toEqual({ id: 1, cancel: true });
  });

  it("dispatches by event name: heartbeat to nobody, server_event by name, every other name by name too", async () => {
    const h = handlers();
    const named: Array<[string, unknown, string | null]> = [];
    socket.stream("/api/projects/p1/machines/events", {
      ...h,
      onEvent: (name, data, eventId) => named.push([name, data, eventId]),
    });
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    last().receive({ id: 1, status: 200, stream: true, headers: {} });
    // A stream's own beat reaches no handler: it is liveness, and the deadline was re-armed.
    last().receive({ id: 1, event: "heartbeat", data: "{}" });
    last().receive({ id: 1, event: "server_event", eventId: "h-1", data: '{"type":"hello"}' });
    // An event with no `event:` line arrives named `message` (sse-text.ts), and stays a record.
    last().receive({ id: 1, event: "message", eventId: "1-2", data: '{"kind":"m"}' });
    last().receive({
      id: 1,
      event: "machine_event",
      eventId: "a1b2c3d4-7",
      data: '{"machineId":"m1","event":{"type":"hello"}}',
    });
    expect(named).toEqual([
      ["machine_event", { machineId: "m1", event: { type: "hello" } }, "a1b2c3d4-7"],
    ]);
    expect(h.server).toEqual([{ type: "hello" }]);
    expect(h.records).toEqual([{ kind: "m" }]);
  });

  it("treats an unlisted event name as an AmspRecord when the caller supplied no onEvent", async () => {
    const h = handlers();
    socket.stream("/api/events", h);
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    last().receive({ id: 1, status: 200, stream: true, headers: {} });
    last().receive({ id: 1, event: "heartbeat", data: "{}" });
    last().receive({
      id: 1,
      event: "machine_event",
      eventId: "a1b2c3d4-7",
      data: '{"machineId":"m1"}',
    });
    expect(h.records).toEqual([{ machineId: "m1" }]); // unchanged behaviour for every existing caller
    expect(h.server).toEqual([]);
  });

  it("re-issues a stream after a drop with the last event id, on a fresh socket", async () => {
    const h = handlers();
    socket.stream("/api/sessions/s1/stream", h);
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
    socket.stream("/server/m1/api/events", h);
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

  it("keeps trying after four handshakes that never opened: the fifth is a real attempt, one backoff step later", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = handlers();
    const conn = socket.stream("/api/events", h);
    // Four handshakes in a row that never opened, each one retried on the next step of the one
    // ladder: 1 s, 2 s, 4 s, 8 s. A failed attempt costs exactly one step — a handshake that
    // reached the server and failed books its next timer in `#dropped`, and
    // `#scheduleReconnect`'s continuation then finds it armed and spends nothing (see
    // `#scheduleReconnect`).
    // What matters for this patch is that the ladder never ends: no state changes, no give-up.
    const steps = [1_000, 2_000, 4_000, 8_000];
    for (let i = 0; i < steps.length; i++) {
      await Promise.resolve();
      await Promise.resolve();
      expect(FakeSocket.instances).toHaveLength(i + 1);
      last().drop(); // closed before it ever opened
      // Let the event loop's microtasks run, as they do between a real close event and the next
      // timer: this is where the reconnect's continuation spends its value.
      await Promise.resolve();
      expect(socket.isUnavailable()).toBe(false);
      expect(socket.isOpen()).toBe(false);
      vi.advanceTimersByTime(steps[i]! - 1);
      expect(FakeSocket.instances).toHaveLength(i + 1); // not before its backoff
      vi.advanceTimersByTime(1);
    }
    await Promise.resolve();
    await Promise.resolve();
    // The fifth attempt: made, on the ladder's next step, with no reload and no new state.
    expect(FakeSocket.instances).toHaveLength(5);
    expect(socket.isUnavailable()).toBe(false);
    last().open();
    expect(socket.isOpen()).toBe(true);
    expect(last().frames()[0]).toEqual({
      id: 1,
      call: { method: "GET", path: "/api/events", headers: { accept: "text/event-stream" } },
    });
    last().receive({ id: 1, status: 200, stream: true, headers: {} });
    expect(h.opens).toBe(1);
    // One line per failed handshake, naming no count: nothing is being counted up.
    const lines = warn.mock.calls
      .map(([m]) => String(m))
      .filter((m) => m.includes("the handshake did not open"));
    expect(lines).toHaveLength(4);
    expect(lines.some((m) => /\d+\/\d+/.test(m))).toBe(false);
    expect(warn.mock.calls.some(([m]) => String(m).includes("giving up"))).toBe(false);
    conn.close();
    warn.mockRestore();
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

  it("a stream waiting when the browser has no WebSocket stays silent, never answered", async () => {
    vi.stubGlobal("WebSocket", undefined);
    const noWs = new ApiSocket(
      () => "ws://test/socket",
      async () => "admin",
    );
    const h = handlers();
    noWs.stream("/api/events", h);
    expect(h.errors).toEqual([]); // waiting on the identity, as with a socket
    await Promise.resolve();
    await Promise.resolve();
    expect(noWs.isUnavailable()).toBe(true);
    expect(h.errors).toEqual([]); // silent: no error either, the stream simply has no transport
  });

  it("starts unavailable when told there is nothing to connect to", async () => {
    const offPage = new ApiSocket(
      () => "ws://test/socket",
      async () => "admin",
      false,
    );
    expect(offPage.isUnavailable()).toBe(true);
    await expect(offPage.ready()).resolves.toBe(false);
  });
});

describe("robustness", () => {
  it("closes a socket that has gone silent for two beats and brings the streams back", async () => {
    const h = handlers();
    socket.stream("/api/events", h);
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
    socket.stream("/api/events", handlers());
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

  it("drops the reconnect booked for a parked stream once that stream closes", async () => {
    const conn = socket.stream("/api/events", handlers());
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    last().drop(); // parked, with a reconnect booked on the backoff
    conn.close(); // the page that held it is gone
    expect(vi.getTimerCount()).toBe(0); // nothing left to fire after the page
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(1);
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

  it("ends every call it took out of the queue when the socket cannot send", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const answers = [1, 2, 3, 4].map((n) =>
      socket.call("POST", `/api/write/${n}`, { body: { n } }),
    );
    await settle(); // the identity settles and the socket is handed to the client
    expect(FakeSocket.instances).toHaveLength(1);
    const ws = last();
    ws.send = () => {
      throw new Error("InvalidStateError");
    };
    ws.open();
    const settled = await Promise.allSettled(answers);
    // Every call is over: rejected here or refused by the close — none is left without a deadline.
    expect(settled.map((s) => s.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
    expect(settled.map((s) => (s as PromiseRejectedResult).reason.message)).toEqual([
      "socket_closed",
      "socket_closed",
      "socket_closed",
      "socket_closed",
    ]);
    expect(socket.report().pendingCalls).toEqual([]);
    expect(warn.mock.calls.some(([m]) => String(m).includes("could not be sent"))).toBe(true);
    warn.mockRestore();
  });

  it("keeps the streams coming back when a call in the batch cannot be sent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = handlers();
    await openViaReady();
    socket.stream("/api/events", h);
    last().receive({ id: 1, status: 200, stream: true, headers: {} });
    expect(h.opens).toBe(1);
    last().drop(); // the stream is parked; the reconnect is one backoff step out
    const answers = [
      socket.call("GET", "/api/a"),
      socket.call("GET", "/api/b"),
      socket.call("GET", "/api/c"),
    ];
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(FakeSocket.instances).toHaveLength(2);
    const ws = last();
    let sends = 0;
    ws.send = () => {
      sends += 1;
      if (sends === 2) throw new Error("InvalidStateError"); // the second frame of the batch
    };
    ws.open();
    const settled = await Promise.allSettled(answers);
    expect(settled.map((s) => s.status)).toEqual(["rejected", "rejected", "rejected"]);
    // The failed batch did not cost the stream its place: the next attempt carries it.
    vi.advanceTimersByTime(2_000);
    await settle();
    expect(FakeSocket.instances).toHaveLength(3);
    last().open();
    // The stream is the fourth frame the client ever numbered: the refused batch's third call
    // never reached the wire, so it took no id. What matters is that the stream arrived.
    expect(last().frames()).toEqual([
      {
        id: 4,
        call: { method: "GET", path: "/api/events", headers: { accept: "text/event-stream" } },
      },
    ]);
    last().receive({ id: 4, status: 200, stream: true, headers: {} });
    expect(h.opens).toBe(2);
    warn.mockRestore();
  });

  it("refuses only the call that cannot be framed, and sends the rest of the batch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const bad = socket.call("POST", "/api/bad", { body: circular });
    const good = socket.call("POST", "/api/good", { body: { ok: true } });
    await settle();
    last().open();
    await expect(bad).rejects.toThrow("socket_unserializable");
    expect(last().frames()).toEqual([
      { id: 2, call: { method: "POST", path: "/api/good", body: { ok: true } } },
    ]);
    last().receive({ id: 2, status: 200, headers: {}, body: { ok: true } });
    await expect(good).resolves.toEqual({ status: 200, headers: {}, body: { ok: true } });
    expect(socket.isOpen()).toBe(true); // the socket itself is fine: only that one call was not
    warn.mockRestore();
  });
});

describe("deadlines", () => {
  it("closes a handshake that neither opens nor fails, and leaves the socket retryable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ready = socket.ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(9_999);
    expect(socket.isOpen()).toBe(false);
    vi.advanceTimersByTime(1); // the handshake deadline: the client closes it itself
    await expect(ready).resolves.toBe(false); // the waiting call goes over HTTP
    expect(warn.mock.calls.some(([m]) => String(m).includes("neither opened nor failed"))).toBe(
      true,
    );
    expect(socket.isUnavailable()).toBe(false); // one stuck handshake is retried, not given up
    warn.mockRestore();
  });

  it("gives up on a one-shot call the server never answers, saying so, while the socket stays open", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await openViaReady();
    const answer = socket.call("GET", "/api/sessions/s1/messages");
    last().receive({ heartbeat: true }); // the server is alive, just not answering this
    vi.advanceTimersByTime(19_999);
    expect(socket.report().pendingCalls).toEqual(["GET /api/sessions/s1/messages"]);
    vi.advanceTimersByTime(1);
    await expect(answer).rejects.toThrow("socket_timeout");
    expect(socket.report().pendingCalls).toEqual([]);
    expect(socket.isOpen()).toBe(true);
    const line = String(warn.mock.calls.find(([m]) => String(m).includes("no answer"))?.[0]);
    expect(line).toContain("GET /api/sessions/s1/messages");
    expect(line).toContain("open (last frame");
    // A late answer for the given-up id is ignored, not crashed on.
    last().receive({ id: 1, status: 200, headers: {}, body: {} });
    warn.mockRestore();
  });

  it("cancels a call it gives up on, so the server stops working it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await openViaReady();
    const answer = socket.call("GET", "/server/m1/api/projects/p/agents/a/sessions");
    const ws = last();
    const { id } = ws.frames().find((f) => "call" in f) as { id: number };
    const cancels = () => ws.frames().filter((f) => "cancel" in f);
    last().receive({ heartbeat: true });
    vi.advanceTimersByTime(19_999);
    // Not before its time: the call is still the server's to answer.
    expect(cancels()).toEqual([]);
    vi.advanceTimersByTime(1);
    await expect(answer).rejects.toThrow("socket_timeout");
    // The cancel names the given-up call, so the server aborts that Request and the machine
    // proxy drops its forward (socket/serve.ts, machines/proxy.ts).
    expect(cancels()).toEqual([{ id, cancel: true }]);
    warn.mockRestore();
  });

  it("says whether the socket carried frames while a given-up call waited", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await openViaReady();
    const live = socket.call("GET", "/server/m1/api/projects/p/agents/a/sessions");
    last().receive({ heartbeat: true }); // traffic after the call went out
    vi.advanceTimersByTime(20_000);
    const liveErr = await live.catch((e: unknown) => e);
    expect(liveErr).toBeInstanceOf(SocketTimeoutError);
    expect((liveErr as SocketTimeoutError).socketLive).toBe(true);
    // Nothing at all after the call went out: the socket itself went quiet. (A beat just
    // before it keeps the watchdog from closing the socket first.)
    last().receive({ heartbeat: true });
    const quiet = socket.call("GET", "/server/m1/api/projects/p/agents/b/sessions");
    vi.advanceTimersByTime(20_000);
    const quietErr = await quiet.catch((e: unknown) => e);
    expect(quietErr).toBeInstanceOf(SocketTimeoutError);
    expect((quietErr as SocketTimeoutError).socketLive).toBe(false);
    warn.mockRestore();
  });

  it("issues a stream again when the server has not opened it in time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = handlers();
    socket.stream("/api/sessions/s1/stream", h);
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    expect(last().frames()).toHaveLength(1);
    vi.advanceTimersByTime(20_000); // no `stream` frame came back
    expect(last().frames()[1]).toEqual({ id: 1, cancel: true });
    vi.advanceTimersByTime(1_000); // re-issued after the usual pause
    const again = last().frames()[2] as { id: number; call: { path: string } };
    expect(again.id).toBe(2);
    expect(again.call.path).toBe("/api/sessions/s1/stream");
    expect(warn.mock.calls.some(([m]) => String(m).includes("not opened in"))).toBe(true);
    // Once opened, the deadline is off: a long quiet stream is not re-issued.
    last().receive({ id: 2, status: 200, stream: true, headers: {} });
    expect(h.opens).toBe(1);
    vi.advanceTimersByTime(20_000);
    expect(last().frames()).toHaveLength(3);
    warn.mockRestore();
  });

  it("backs a machine stream off on its own while the hub says no socket carries it, and resets once it opens", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = handlers();
    socket.stream("/server/m1/api/events", h);
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    const refuse = (id: number) =>
      last().receive({
        id,
        status: 502,
        headers: {},
        body: { error: { code: "machine_socket_unavailable", message: "No API socket to m1" } },
      });
    refuse(1);
    vi.advanceTimersByTime(999);
    expect(last().frames()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(last().frames()).toHaveLength(2); // 1 s
    refuse(2);
    vi.advanceTimersByTime(1_999);
    expect(last().frames()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(last().frames()).toHaveLength(3); // 2 s
    expect(warn.mock.calls.some(([m]) => String(m).includes("No API socket to m1"))).toBe(true);
    last().receive({ id: 3, status: 200, stream: true, headers: {} });
    last().receive({ id: 3, end: true, reason: "lagging" });
    vi.advanceTimersByTime(1_000);
    expect(last().frames()).toHaveLength(4);
    refuse(4);
    vi.advanceTimersByTime(1_000);
    expect(last().frames()).toHaveLength(5); // back to 1 s after the open
    warn.mockRestore();
  });

  it("issues a stream once when a reconnect comes before its own retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    socket.stream("/server/m1/api/events", handlers());
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    const refuse = (id: number) =>
      last().receive({
        id,
        status: 502,
        headers: {},
        body: { error: { code: "machine_socket_unavailable", message: "No API socket to m1" } },
      });
    refuse(1);
    vi.advanceTimersByTime(1_000);
    refuse(2); // its own retry is now 2 s away
    last().drop(); // the reconnect is 1 s away, and issues every waiting stream
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    expect(last().frames()).toHaveLength(1);
    vi.advanceTimersByTime(5_000); // past the stream's own retry
    const calls = last()
      .frames()
      .filter((f) => "call" in f);
    expect(calls).toHaveLength(1);
    warn.mockRestore();
  });
});

describe("per-stream heartbeat", () => {
  /** A watched stream, opened and handed a frame so its own deadline is armed. */
  async function watched(h: StreamHandlers): Promise<StreamConnection> {
    const conn = socket.stream("/api/projects/p1/machines/events", h, { heartbeatMs: 20_000 });
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    last().receive({ id: 1, status: 200, stream: true, headers: {} });
    last().receive({
      id: 1,
      event: "machine_event",
      eventId: "a1b2c3d4-7",
      data: '{"machineId":"m1","event":{"type":"hello"}}',
    });
    return conn;
  }

  it("ends a stream that misses two beats and re-subscribes it from its last event id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = handlers();
    await watched(h);
    // The socket's own beat keeps the SOCKET alive; it says nothing about this stream.
    vi.advanceTimersByTime(39_000);
    last().receive({ heartbeat: true });
    expect(socket.isOpen()).toBe(true);
    expect(h.errors).toEqual([]);
    vi.advanceTimersByTime(1_000); // two beats of stream silence since the machine_event
    expect(h.errors).toEqual([false]); // ended, not closed: the caller's reconnect stands
    expect(last().frames()[1]).toEqual({ id: 1, cancel: true });
    expect(
      warn.mock.calls.some(
        ([m]) =>
          String(m).includes("no frame for 40000 ms") &&
          String(m).includes("re-subscribing from its last event id"),
      ),
    ).toBe(true);
    vi.advanceTimersByTime(1_000); // the usual re-issue pause
    expect(last().frames()[2]).toEqual({
      id: 2,
      call: {
        method: "GET",
        path: "/api/projects/p1/machines/events",
        headers: { accept: "text/event-stream", "last-event-id": "a1b2c3d4-7" },
      },
    });
    warn.mockRestore();
  });

  it("keeps a watched stream that speaks on every beat", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = handlers();
    await watched(h);
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(20_000);
      last().receive({ id: 1, event: "heartbeat", data: "{}" });
    }
    expect(h.errors).toEqual([]);
    expect(last().frames()).toHaveLength(1); // never re-issued
    warn.mockRestore();
  });

  it("watches nothing on a stream whose caller asked for no heartbeat", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const quiet = handlers();
    socket.stream("/api/sessions/s1/stream", quiet);
    await Promise.resolve();
    await Promise.resolve();
    last().open();
    last().receive({ id: 1, status: 200, stream: true, headers: {} });
    // Two minutes of silence, with only the socket's own beat keeping the socket up.
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(20_000);
      last().receive({ heartbeat: true });
    }
    expect(quiet.errors).toEqual([]);
    expect(last().frames()).toHaveLength(1);
    warn.mockRestore();
  });

  it("never fires after close()", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = handlers();
    const conn = await watched(h);
    conn.close();
    expect(last().frames()[1]).toEqual({ id: 1, cancel: true });
    vi.advanceTimersByTime(120_000);
    expect(h.errors).toEqual([]);
    expect(
      warn.mock.calls.some(([m]) => String(m).includes("re-subscribing from its last event id")),
    ).toBe(false);
    warn.mockRestore();
  });

  it("does not end a stream the socket dropped — the drop has already been reported", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = handlers();
    await watched(h);
    last().drop();
    expect(h.errors).toEqual([false]); // the drop itself, once
    vi.advanceTimersByTime(120_000);
    expect(h.errors).toEqual([false]); // and nothing more from the stream's own deadline
    expect(
      warn.mock.calls.some(([m]) => String(m).includes("re-subscribing from its last event id")),
    ).toBe(false);
    warn.mockRestore();
  });
});
