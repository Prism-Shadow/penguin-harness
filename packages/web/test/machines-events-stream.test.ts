/**
 * The machines aggregate (openMachineEvents, api/sse.ts) over the page's one API socket.
 *
 * What this pins is the ticket's first acceptance item: watching N machines costs ONE stream —
 * `GET /api/projects/<projectId>/machines/events` — where it used to cost one per machine
 * (`/server/<machineId>/api/events`). The aggregate's frames are what makes that possible:
 * every `machine_event` carries the machine it came from, so a tab holds one subscription and
 * still routes each event to the right machine, the hub's own `server_event` frames (`hello`,
 * `resync_required`) go to their own handler, and the stream's `heartbeat` reaches nobody.
 *
 * The layer is the real one: a scripted WebSocket plays the server behind the page's
 * `apiSocket` singleton, so the frames asserted here are the frames that would go on the wire.
 * The module registry is reset per test, which is what gives each test its own socket and its
 * own identity. There is no React tree in this package's Node environment and none is needed —
 * this is the transport and its adapters, not the render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import type { MachineStreamHandlers, StreamConnection } from "../src/api/sse";

/** A WebSocket the test drives by hand (the harness api-socket.test.ts uses). */
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
  frames(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const last = () => FakeSocket.instances[FakeSocket.instances.length - 1]!;

/** openMachineEvents' handlers, recording everything they are handed. */
interface Recorder extends MachineStreamHandlers {
  machines: Array<{ machineId: string; event: ServerEvent; eventId: string | null }>;
  hub: Array<{ event: ServerEvent; eventId: string | null }>;
  opens: number;
  errors: boolean[];
}

function recorder(): Recorder {
  const r: Recorder = {
    machines: [],
    hub: [],
    opens: 0,
    errors: [],
    onMachineEvent: (machineId, event, eventId) => r.machines.push({ machineId, event, eventId }),
    onHubEvent: (event, eventId) => r.hub.push({ event, eventId }),
    onOpen: () => {
      r.opens += 1;
    },
    onError: (closed) => {
      r.errors.push(closed);
    },
  };
  return r;
}

/**
 * Lets the socket settle its identity (`/api/me`, its JSON answer) and open, so the handshake
 * can be completed by hand — the same dance api-socket.test.ts does, with the extra ticks the
 * stubbed `fetch` costs.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Opens the aggregate exactly as the page does, and settles the socket's handshake. */
async function openAggregate(
  handlers: MachineStreamHandlers,
  projectId = "p1",
): Promise<StreamConnection> {
  // Imported here, after the registry reset in beforeEach, so each test gets its own socket.
  const { openMachineEvents } = await import("../src/api/sse");
  const conn = openMachineEvents(projectId, handlers);
  await settle();
  last().open();
  last().receive({ id: 1, status: 200, stream: true, headers: {} });
  return conn;
}

beforeEach(() => {
  vi.resetModules();
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("location", { protocol: "http:", host: "test" });
  vi.stubGlobal("fetch", async () => ({
    status: 200,
    ok: true,
    json: async () => ({ user: { userId: "admin" } }),
  }));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("openMachineEvents", () => {
  it("holds ONE stream for the project, and carries every machine's events through it", async () => {
    const r = recorder();
    await openAggregate(r);
    // The whole tab's machines on one call — whatever the machine count, this is the only frame.
    expect(last().frames()).toEqual([
      {
        id: 1,
        call: {
          method: "GET",
          path: "/api/projects/p1/machines/events",
          headers: { accept: "text/event-stream" },
        },
      },
    ]);
    expect(r.opens).toBe(1);
    last().receive({ id: 1, event: "server_event", eventId: "hub-1", data: '{"type":"hello"}' });
    for (const [i, machineId] of ["m1", "m2", "m3"].entries()) {
      last().receive({
        id: 1,
        event: "machine_event",
        eventId: `a1b2c3d4-${i + 1}`,
        data: JSON.stringify({
          machineId,
          event: { type: "session_state", sessionId: `s${i}`, state: "running" },
        }),
      });
    }
    expect(r.machines).toEqual([
      {
        machineId: "m1",
        event: { type: "session_state", sessionId: "s0", state: "running" },
        eventId: "a1b2c3d4-1",
      },
      {
        machineId: "m2",
        event: { type: "session_state", sessionId: "s1", state: "running" },
        eventId: "a1b2c3d4-2",
      },
      {
        machineId: "m3",
        event: { type: "session_state", sessionId: "s2", state: "running" },
        eventId: "a1b2c3d4-3",
      },
    ]);
    // The hub's own frame went to its own handler, not into the machines'.
    expect(r.hub).toEqual([{ event: { type: "hello" }, eventId: "hub-1" }]);
    // Three machines later, still one stream.
    expect(last().frames()).toHaveLength(1);
  });

  it("sends the heartbeat to nobody, skips malformed JSON, and drops a frame without a machine", async () => {
    const r = recorder();
    await openAggregate(r);
    last().receive({ id: 1, event: "heartbeat", data: "{}" });
    last().receive({ id: 1, event: "machine_event", eventId: "a1b2c3d4-4", data: "not json" });
    last().receive({
      id: 1,
      event: "machine_event",
      eventId: "a1b2c3d4-5",
      data: '{"machineId":42,"event":{"type":"hello"}}',
    });
    expect(r.machines).toEqual([]);
    expect(r.hub).toEqual([]);
    // The stream is untouched by all of it: nothing was cancelled, nothing re-issued.
    expect(last().frames()).toHaveLength(1);
  });

  it("carries the watchdog: two beats of silence end it and re-subscribe from the last event id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = recorder();
    await openAggregate(r);
    last().receive({
      id: 1,
      event: "machine_event",
      eventId: "a1b2c3d4-9",
      data: '{"machineId":"m1","event":{"type":"hello"}}',
    });
    // The socket's own beat keeps the socket up while the stream says nothing.
    vi.advanceTimersByTime(39_000);
    last().receive({ heartbeat: true });
    expect(r.errors).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(r.errors).toEqual([false]); // the stream was ended, not closed
    expect(last().frames()[1]).toEqual({ id: 1, cancel: true });
    vi.advanceTimersByTime(1_000);
    expect(last().frames()[2]).toMatchObject({
      id: 2,
      call: {
        path: "/api/projects/p1/machines/events",
        headers: { "last-event-id": "a1b2c3d4-9" },
      },
    });
    warn.mockRestore();
  });

  it("percent-encodes the project id into the aggregate's path", async () => {
    const r = recorder();
    const conn = await openAggregate(r, "proj/with space");
    expect((last().frames()[0] as { call: { path: string } }).call.path).toBe(
      "/api/projects/proj%2Fwith%20space/machines/events",
    );
    conn.close();
    expect(last().frames()[1]).toEqual({ id: 1, cancel: true });
  });
});
