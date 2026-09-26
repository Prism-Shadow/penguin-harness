/**
 * The event hub (machines/event-hub.ts) against scripted machines: ONE `/api/events`
 * subscription per machine however many readers ask for it — the aggregation PRFC-0011 named and
 * did not do — each machine's stream served in its own words out of that subscription's buffer,
 * the machine's heartbeat event arming the hub's silence watchdog, and the aggregate stream that
 * gives one tab ONE stream whatever the machine count, every event tagged with its machine.
 */
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { SseParser } from "../src/socket/sse-text.js";
import type { SseEvent } from "../src/socket/sse-text.js";
import { MachineEventHub, machineEventsStream } from "../src/machines/event-hub.js";
import type { MachineEventSource } from "../src/machines/event-hub.js";
import { MachineSockets } from "../src/machines/machine-sockets.js";
import { MachineSocketRelay } from "../src/machines/socket-relay.js";

/** One call frame the machine received. */
interface ScriptedCall {
  ws: WebSocket;
  id: number;
  path: string;
  headers: Record<string, string>;
}

/**
 * A machine's socket endpoint, scripted: it opens every call it is given, records it, and pushes
 * whatever the test says — an event with an id, or the beat its `/api/events` writes itself.
 */
async function machine(options: { beatMs?: number } = {}) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const connections: WebSocket[] = [];
  const calls: ScriptedCall[] = [];
  const timers = new Map<WebSocket, ReturnType<typeof setInterval>>();
  wss.on("connection", (ws) => {
    connections.push(ws);
    timers.set(
      ws,
      setInterval(() => ws.send(JSON.stringify({ heartbeat: true })), options.beatMs ?? 15),
    );
    ws.on("close", () => {
      const timer = timers.get(ws);
      if (timer !== undefined) clearInterval(timer);
      timers.delete(ws);
    });
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString()) as {
        id: number;
        call?: { path: string; headers?: Record<string, string> };
        cancel?: boolean;
      };
      if (frame.cancel === true || frame.call === undefined) return;
      calls.push({ ws, id: frame.id, path: frame.call.path, headers: frame.call.headers ?? {} });
      ws.send(JSON.stringify({ id: frame.id, status: 200, stream: true, headers: {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const eventCalls = () => calls.filter((call) => call.path.split("?")[0] === "/api/events");
  return {
    port,
    connections,
    eventCalls,
    /** Waits until this machine is carrying `count` `/api/events` streams (the hub dials as it attaches). */
    async waitForCalls(count: number, ms = 3_000): Promise<void> {
      const until = Date.now() + ms;
      while (eventCalls().length < count && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    /** The machine's `/api/events` says something: one event, as its own SSE writer frames it. */
    emit(eventId: string, event: unknown) {
      const call = eventCalls().at(-1);
      if (call === undefined) throw new Error("the machine has no open /api/events stream");
      call.ws.send(
        JSON.stringify({
          id: call.id,
          event: "server_event",
          eventId,
          data: JSON.stringify(event),
        }),
      );
    },
    /** The machine's App stops writing its beat — the socket stays healthy, the stream does not. */
    stopBeats() {
      for (const timer of timers.values()) clearInterval(timer);
      timers.clear();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const timer of timers.values()) clearInterval(timer);
        for (const ws of connections) ws.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

/** Reads a Response body as SSE, so a test can wait for what a reader would have seen. */
class Tap {
  readonly events: SseEvent[] = [];
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  #closed = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    this.#reader = reader;
    const parser = new SseParser();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const event of parser.feed(decoder.decode(value, { stream: true }))) {
            this.events.push(event);
          }
        }
      } catch {
        // A cancelled body is a closed tap too.
      }
      this.#closed = true;
    })();
  }

  /** The reader went away — the tab reloaded, or its network did. */
  async close(): Promise<void> {
    await this.#reader.cancel().catch(() => undefined);
  }

  /** The frames of one name, which is what these cases assert on (a heartbeat may sit anywhere). */
  frames(name: string): SseEvent[] {
    return this.events.filter((event) => event.event === name);
  }

  async waitFor(count: number, ms = 3_000): Promise<SseEvent[]> {
    const until = Date.now() + ms;
    while (this.events.length < count && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return this.events;
  }

  async waitClosed(ms = 3_000): Promise<boolean> {
    const until = Date.now() + ms;
    while (!this.#closed && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return this.#closed;
  }

  get closed(): boolean {
    return this.#closed;
  }
}

/** What the hub and the relay are configured with here: beats and timeouts measured in tens of ms. */
function setup() {
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const sockets = new MachineSockets(log, { dialTimeoutMs: 250 });
  const hub = new MachineEventHub(sockets, log, {
    heartbeatMs: 40,
    openTimeoutMs: 250,
    reissueMinMs: 15,
    reissueMaxMs: 40,
  });
  const relay = new MachineSocketRelay(log, { sockets, events: hub });
  return { lines, log, sockets, hub, relay };
}

const targetOf = (port: number) => ({
  agent: new http.Agent(),
  port,
  cookie: "penguin_session=x",
  session: 1,
});

describe("the machine event hub", () => {
  const stops: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) await stop();
  });

  it("subscribes ONCE per machine however many readers ask for its events", async () => {
    const m = await machine();
    stops.push(m.close);
    const { sockets, hub, relay } = setup();
    void sockets;

    const first = await relay.stream("m1", targetOf(m.port), {
      path: "/api/events",
      lastEventId: null,
    });
    const second = await relay.stream("m1", targetOf(m.port), {
      path: "/api/events",
      lastEventId: null,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // The number the ticket is about: two readers, ONE upstream stream.
    expect(m.eventCalls()).toHaveLength(1);
    expect(hub.subscriptions).toBe(1);

    const a = new Tap(first.body!);
    const b = new Tap(second.body!);
    m.emit("3-1", { type: "credentials_updated" });
    expect((await a.waitFor(2)).map((event) => [event.id, event.event])).toContainEqual([
      "3-1",
      "server_event",
    ]);
    expect((await b.waitFor(2)).map((event) => event.id)).toContain("3-1");
    // Still one upstream stream after both readers have been served.
    expect(m.eventCalls()).toHaveLength(1);
  });

  it("serves a machine's stream in the machine's own words, and replays `last-event-id` from its buffer", async () => {
    const m = await machine();
    stops.push(m.close);
    const { relay } = setup();
    const target = targetOf(m.port);

    const res = await relay.stream("m1", target, { path: "/api/events", lastEventId: null });
    const tap = new Tap(res.body!);
    // A fresh reader is handed the handshake, as a channel's subscriber is.
    expect((await tap.waitFor(1))[0]?.data).toBe('{"type":"hello"}');
    m.emit("3-1", { type: "session_state", sessionId: "s" });
    m.emit("3-2", { type: "session_state", sessionId: "s2" });
    const seen = await tap.waitFor(3);
    expect(seen.slice(1).map((event) => [event.id, event.event, event.data])).toEqual([
      ["3-1", "server_event", '{"type":"session_state","sessionId":"s"}'],
      ["3-2", "server_event", '{"type":"session_state","sessionId":"s2"}'],
    ]);

    // A reader joining with an id the buffer still holds gets the gap, and no second upstream stream.
    const joined = await relay.stream("m1", target, { path: "/api/events", lastEventId: "3-1" });
    const tapJoined = new Tap(joined.body!);
    expect((await tapJoined.waitFor(1))[0]).toMatchObject({ id: "3-2", event: "server_event" });
    expect(m.eventCalls()).toHaveLength(1);

    // An id the buffer never held cannot be replayed: the reader is told to resync, like a channel's.
    const missed = await relay.stream("m1", target, { path: "/api/events", lastEventId: "9-9" });
    const tapMissed = new Tap(missed.body!);
    expect((await tapMissed.waitFor(1))[0]?.data).toBe('{"type":"resync_required"}');
  });

  it("ends an upstream that misses two beats and re-subscribes it from the machine's last event id", async () => {
    const m = await machine();
    stops.push(m.close);
    const { lines, relay } = setup();
    const target = targetOf(m.port);

    const res = await relay.stream("m1", target, { path: "/api/events", lastEventId: null });
    const tap = new Tap(res.body!);
    m.emit("3-1", { type: "credentials_updated" });
    await tap.waitFor(2);

    // The machine stops writing its beat while the socket keeps its own: the stream's silence is
    // the only thing that says so, and two beats of it is enough.
    m.stopBeats();
    const until = Date.now() + 3_000;
    while (m.eventCalls().length < 2 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(m.eventCalls()).toHaveLength(2);
    expect(m.eventCalls()[1]?.headers["last-event-id"]).toBe("3-1");
    expect(lines.some((line) => line.includes("re-subscribing it from its last event id"))).toBe(
      true,
    );
    // The reader keeps its stream — the hub repaired the hop under it — and hears what comes next.
    expect(tap.closed).toBe(false);
    m.emit("3-3", { type: "credentials_updated" });
    expect((await tap.waitFor(3)).map((event) => event.id)).toContain("3-3");
  });

  it("gives a tab ONE stream for every machine, each event tagged with the machine it came from", async () => {
    const a = await machine();
    const b = await machine();
    stops.push(a.close, b.close);
    const { hub } = setup();
    const sources: MachineEventSource[] = [
      { machineId: "mA", target: targetOf(a.port) },
      { machineId: "mB", target: targetOf(b.port) },
    ];

    const tab = machineEventsStream(hub, ["mA", "mB"], sources, null, undefined, {
      heartbeatMs: 40,
    });
    const tap = new Tap(tab.body!);
    await a.waitForCalls(1);
    await b.waitForCalls(1);
    a.emit("1-1", { type: "credentials_updated" });
    b.emit("2-1", { type: "session_background", sessionId: "s", processes: 1, subagents: 0 });
    const until = Date.now() + 3_000;
    while (tap.frames("machine_event").length < 2 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(tap.frames("machine_event").map((event) => JSON.parse(event.data) as unknown)).toEqual([
      { machineId: "mA", event: { type: "credentials_updated" } },
      {
        machineId: "mB",
        event: { type: "session_background", sessionId: "s", processes: 1, subagents: 0 },
      },
    ]);
    // ONE upstream stream per machine, whatever the tab count: this is the aggregation's point.
    expect(hub.subscriptions).toBe(2);
    expect(a.eventCalls()).toHaveLength(1);
    expect(b.eventCalls()).toHaveLength(1);

    const secondTab = machineEventsStream(hub, ["mA", "mB"], sources, null, undefined, {
      heartbeatMs: 40,
    });
    const secondTap = new Tap(secondTab.body!);
    expect((await secondTap.waitFor(1))[0]?.data).toBe('{"type":"hello"}');
    expect(hub.subscriptions).toBe(2);
    expect(a.eventCalls()).toHaveLength(1);
    expect(b.eventCalls()).toHaveLength(1);
    a.emit("1-2", { type: "credentials_updated" });
    const until2 = Date.now() + 3_000;
    while (secondTap.frames("machine_event").length < 1 && Date.now() < until2) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(
      secondTap.frames("machine_event").map((event) => JSON.parse(event.data) as unknown),
    ).toEqual([{ machineId: "mA", event: { type: "credentials_updated" } }]);
    // The tab's own beat is on the stream too: a stall in the hub is visible to the tab.
    const until3 = Date.now() + 3_000;
    while (secondTap.frames("heartbeat").length < 1 && Date.now() < until3) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(secondTap.frames("heartbeat").length).toBeGreaterThan(0);
  });

  it("answers an aggregate `last-event-id` from a buffer that outlived the stream it was written on", async () => {
    const m = await machine();
    stops.push(m.close);
    const { hub } = setup();
    const sources: MachineEventSource[] = [{ machineId: "mA", target: targetOf(m.port) }];

    const first = machineEventsStream(hub, ["mA"], sources, null);
    const tap = new Tap(first.body!);
    await m.waitForCalls(1);
    m.emit("1-1", { type: "credentials_updated" });
    const until = Date.now() + 3_000;
    while (tap.frames("machine_event").length < 1 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const cursor = tap.frames("machine_event")[0]?.id;
    expect(cursor).not.toBeNull();
    m.emit("1-2", { type: "session_created", projectId: "p", agentId: "a", sessionId: "s" });
    const until2 = Date.now() + 3_000;
    while (tap.frames("machine_event").length < 2 && Date.now() < until2) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // The tab went away (a reload, a lost network): its stream ends, its id is what it brings back.
    await tap.close();

    const back = machineEventsStream(hub, ["mA"], sources, cursor ?? null);
    const backTap = new Tap(back.body!);
    const until3 = Date.now() + 3_000;
    while (backTap.events.length < 1 && Date.now() < until3) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(
      backTap.frames("machine_event").map((event) => JSON.parse(event.data) as unknown),
    ).toEqual([
      {
        machineId: "mA",
        event: { type: "session_created", projectId: "p", agentId: "a", sessionId: "s" },
      },
    ]);

    // An id from another generation (a restart, a hot push) is a miss, and says so.
    const stale = machineEventsStream(hub, ["mA"], sources, "deadbeef-7");
    const staleTap = new Tap(stale.body!);
    expect((await staleTap.waitFor(1))[0]?.data).toBe('{"type":"resync_required"}');
  });

  it("reports what each machine's socket is doing, for the Machines page", async () => {
    const m = await machine();
    stops.push(m.close);
    const { sockets, relay } = setup();
    expect(sockets.fact("m1")).toBeNull();

    const stream = await relay.stream("m1", targetOf(m.port), {
      path: "/api/events",
      lastEventId: null,
    });
    expect(stream.status).toBe(200);
    expect(sockets.fact("m1")).toMatchObject({ state: "connected" });

    // A machine that answers the handshake with a status is not "connected": its program has no
    // socket, and the page has to be able to say so.
    const refusing = http.createServer((_req, res) => res.writeHead(404).end());
    refusing.on("upgrade", (_req, sock) =>
      sock.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"),
    );
    await new Promise<void>((resolve) => refusing.listen(0, "127.0.0.1", resolve));
    stops.push(() => new Promise<void>((resolve) => refusing.close(() => resolve())));
    const refused = await relay.stream(
      "m2",
      targetOf((refusing.address() as { port: number }).port),
      { path: "/api/events", lastEventId: null },
    );
    expect(refused.status).toBe(502);
    expect(sockets.fact("m2")).toMatchObject({
      state: "refused",
      detail: "machine answered 404",
    });
  });
});
