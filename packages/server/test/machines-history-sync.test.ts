/**
 * A machine Session's history on the hub when the machine's leg misbehaves: the machine is a
 * scripted API socket (the boundary this suite fakes), the reader asks through the
 * `/server/<id>` proxy as the Web App does, and the sync job's timers run on a clock the test
 * moves (machines/history-sync.ts, history-routes.ts).
 *
 * - Given a machine stream that falls silent — no frame, not even its beat — when the
 *   watchdog's time passes, then that call alone is cancelled and asked again, a Session stream
 *   on the same socket keeps its subscription, and the call asked again delivers the window.
 * - Given a large frame still crossing the link, when the watchdog's time passes since the last
 *   whole event but not since the last byte, then the stream is kept.
 * - Given a reader that leaves while its window is on the way, then the machine's call is
 *   cancelled at once.
 * - Given a machine that is not connected, when a window is asked for, then the reader is told
 *   it waits — the attempt, and when the next one is — and the window arrives once it is back.
 * - Given a machine on an older build (its socket answers `history-lines` 421), then the window
 *   is read from its `/messages` over HTTP inside the same stream, the bytes counted as they come;
 *   so is one this server holds no socket to.
 * - Given a machine that turns this server's session away at the handshake, then the stream ends
 *   with `machine_refused`; given one being brought onto this hub's build, the reader is told it
 *   waits; given one this server no longer lists, the stream ends with `machine_not_found`.
 * - Given a machine stream that keeps ending without moving, then it is asked again only after a
 *   growing wait the reader is told of, never at once in a loop.
 * - Given a copy that cannot be written, then the window still arrives, from the stream itself.
 * - Given the generation replaced, then every stream it holds ends without an error (the reader
 *   asks the next one), and a stream asked of it afterwards ends at once.
 * - Given a fill another reader's window stream carries, when the last reader staying for the
 *   fill leaves, then that machine call is cancelled.
 * - Given a Session with more subagents held than a `have` can name, then every open loads: its
 *   `have` stays within the machine's ceiling, and a file left out is simply sent again.
 * - Given the copy over its cap, when a stream completes, then an open job's Session is kept
 *   though it was read longest ago, and a Session no job holds goes.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import type { Socket } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { HistoryLinesWindow, HistoryProgress } from "../src/api/types.js";
import { machineHistory } from "../src/machines/history-routes.js";
import { MachineSockets } from "../src/machines/machine-sockets.js";
import type { MachineSocket } from "../src/machines/machine-sockets.js";
import { LinkActivity } from "../src/machines/link-activity.js";
import { machinesProxy } from "../src/machines/proxy.js";
import type { ProxyTarget } from "../src/machines/proxy.js";
import { TraceCache } from "../src/machines/trace-cache.js";
import { decodeHistoryHave } from "../src/services/history-wire.js";
import {
  MACHINE_STREAM_STALL_MS,
  MACHINE_STREAM_WATCHDOG_MS,
  SESSION_CONFIRM_TTL_MS,
} from "../src/machines/history-sync.js";
import { eventReader, manualClock, traceLine, windowRecords } from "./fixtures/history-stream.js";
import { makeTempRoot, removeTempRoot, waitFor } from "./helpers.js";

const MACHINE = "QS7J4YVgSovi-Z2c";
const SID = "session-2026-10-29-09-00-00-00000001";
const K = `default_agent/${SID}/1`;
const FILE = traceLine(0, "hello", "user") + traceLine(1, "hi there");

type ClientFrame = { id: number; call?: { path: string }; cancel?: true; ack?: number };

/** The machine's socket and HTTP port: `answer` decides what a call gets; every frame is kept. */
async function scriptedMachine(
  answer: (ws: WebSocket, id: number, path: string) => void,
  httpAnswer: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) => {
    res.statusCode = 404;
    res.end();
  },
) {
  const server = http.createServer(httpAnswer);
  const wss = new WebSocketServer({ server });
  const frames: ClientFrame[] = [];
  const sockets: WebSocket[] = [];
  let pings = 0;
  wss.on("connection", (ws) => {
    sockets.push(ws);
    ws.on("ping", () => (pings += 1));
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as ClientFrame;
      frames.push(frame);
      if (frame.call !== undefined) answer(ws, frame.id, frame.call.path);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as { port: number }).port,
    frames,
    /** The ids of the calls made to `pathPart`, in order. */
    calls: (pathPart: string) =>
      frames.filter((f) => f.call?.path.includes(pathPart)).map((f) => f.id),
    cancelled: (id: number) => frames.some((f) => f.id === id && f.cancel === true),
    /** The protocol pings the hub sent. */
    pings: () => pings,
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of sockets) ws.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

/** A TCP valve to `port`: while shut, the bytes coming back are held, and let through as the test says. */
async function valveTo(port: number) {
  let held: Buffer[] = [];
  let shut = false;
  let near: Socket | null = null;
  const open = new Set<Socket>();
  const server = net.createServer((client) => {
    const far = net.connect(port, "127.0.0.1");
    open.add(client);
    open.add(far);
    near = client;
    client.pipe(far);
    far.on("data", (bytes: Buffer) => {
      if (shut) held.push(bytes);
      else client.write(bytes);
    });
    for (const end of [client, far]) {
      end.on("error", () => undefined);
      end.on("close", () => {
        client.destroy();
        far.destroy();
      });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as { port: number }).port,
    shut: () => {
      shut = true;
    },
    held: () => held.reduce((n, bytes) => n + bytes.length, 0),
    /** Lets the next `n` held bytes through. */
    release: (n: number) => {
      const all = Buffer.concat(held);
      held = [all.subarray(n)];
      near?.write(all.subarray(0, n));
    },
    open: () => {
      shut = false;
      near?.write(Buffer.concat(held));
      held = [];
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

const send = (ws: WebSocket, frame: object) => ws.send(JSON.stringify(frame));
/** A stream's start, echoing acknowledged flow as a machine's server does (the hub acks only then). */
const start = (ws: WebSocket, id: number) =>
  send(ws, { id, status: 200, stream: true, headers: { "x-flow": "credit" } });
const event = (
  ws: WebSocket,
  id: number,
  name: string,
  data: unknown,
  eventId: string | null = null,
) => send(ws, { id, event: name, eventId, data: JSON.stringify(data) });

/** The window event of a one-file Session whose whole file is the window. */
const windowOf = (file: string, k = K): HistoryLinesWindow => ({
  envelope: {
    page: {
      earlierTurns: 0,
      units: 1,
      prior: {
        subagentTokens: 0,
        elapsedMs: 0,
        apiMs: 0,
        toolMs: 0,
        sessionTokens: 0,
        contextTokens: 0,
      },
    },
    pendingInputs: [],
    serverNowMs: 1_700_000_000_000,
    status: "idle",
  },
  files: [
    {
      k,
      ino: "11",
      birthtimeMs: 5,
      size: Buffer.byteLength(file),
      records: file.split("\n").length - 1,
      final: false,
    },
  ],
  layout: [
    { k, from: [0, 0], to: [Buffer.byteLength(file), file.split("\n").length - 1], origin: null },
  ],
  stubs: [],
  totals: {
    window: { bytes: Buffer.byteLength(file), lines: file.split("\n").length - 1 },
    heavy: { bytes: 0, lines: 0 },
    fill: { bytes: 0, lines: 0 },
  },
});

/** The Session a machine call names. */
const sessionOf = (callPath: string): string => /\/api\/sessions\/([^/]+)\//.exec(callPath)![1]!;

/** The whole answer of a healthy machine to one window call (the one-file Session it names). */
function answerWindow(ws: WebSocket, id: number, callPath?: string): void {
  const sid = callPath !== undefined ? sessionOf(callPath) : SID;
  const k = `default_agent/${sid}/1`;
  start(ws, id);
  event(ws, id, "window", windowOf(FILE, k));
  event(ws, id, "lines", { k, off: 0, ord: 0, text: FILE });
  event(ws, id, "ready", {});
  event(ws, id, "done", {});
  send(ws, { id, end: true, reason: "closed" });
}

let root: string;
let clock: ReturnType<typeof manualClock>;
let sockets: MachineSockets;
let close: Array<() => Promise<void> | void>;

beforeEach(async () => {
  root = await makeTempRoot();
  clock = manualClock();
  sockets = new MachineSockets(() => undefined);
  close = [];
});

afterEach(async () => {
  for (const fn of close.reverse()) await fn();
  sockets.close();
  await removeTempRoot(root);
});

/** The hub's proxy to the machine on `port`, its history answered from a copy under the temp root. */
function hub(
  port: number,
  options: {
    connected?: () => boolean;
    known?: (machineId: string) => boolean;
    /** What the socket cache answers instead of a socket (machine-sockets.ts's refusals). */
    refusal?: () => Response | null;
    cache?: TraceCache;
    /** Sees each socket the job is handed. */
    onSocket?: (socket: MachineSocket) => void;
    /** The machine's link, as MachinesService taps every connection it dials to it. */
    links?: LinkActivity;
    log?: (line: string) => void;
    windowTextMax?: number;
  } = {},
) {
  const connected = options.connected ?? (() => true);
  const links = options.links;
  const agent = (): http.Agent =>
    links === undefined ? new http.Agent() : links.tap(MACHINE, new http.Agent());
  const target = (): ProxyTarget | null =>
    connected() ? { agent: agent(), port, cookie: "c", adoptedAt: null, session: 1 } : null;
  const cache = options.cache ?? new TraceCache(path.join(root, "machines", "traces"));
  const refusal = options.refusal;
  const { history, sync } = machineHistory({
    cache,
    sockets: {
      socketFor: async (machineId, at) => {
        const answer = refusal?.() ?? null;
        if (answer !== null) return { answer };
        const got = await sockets.socketFor(machineId, at);
        if ("socket" in got) options.onSocket?.(got.socket);
        return got;
      },
    },
    target: async () => target(),
    ...(options.known !== undefined ? { known: options.known } : {}),
    ...(links !== undefined ? { heardAt: (machineId: string) => links.heardAt(machineId) } : {}),
    log: options.log ?? (() => undefined),
    tuning: {
      clock,
      ...(options.windowTextMax !== undefined ? { windowTextMax: options.windowTextMax } : {}),
    },
  });
  close.push(() => sync.close());
  const proxy = machinesProxy(
    async () => target(),
    undefined,
    () => undefined,
    { sockets, history },
  );
  const get = async (remote: string, headers: Record<string, string> = {}) =>
    (await proxy(new Request(`http://localhost/server/${MACHINE}${remote}`, { headers })))!;
  return { get, sync, cache };
}

const progressOf = (events: { event: string; data: string }[]): HistoryProgress[] =>
  events.filter((e) => e.event === "progress").map((e) => JSON.parse(e.data) as HistoryProgress);

describe("a machine Session's history when the machine's leg misbehaves", () => {
  it("cuts only the silent stream at its watchdog and asks again, while a Session stream on the same socket stays", async () => {
    let historyCalls = 0;
    const machine = await scriptedMachine((ws, id, callPath) => {
      if (callPath.includes("/history-lines")) {
        historyCalls += 1;
        if (historyCalls === 1) {
          start(ws, id);
          event(ws, id, "window", windowOf(FILE));
          return; // then silence: no lines, no beat
        }
        answerWindow(ws, id);
        return;
      }
      start(ws, id);
      event(ws, id, "ping", {});
    });
    close.push(machine.close);
    const { get } = hub(machine.port);

    const live = eventReader(
      await get(`/api/sessions/${SID}/stream`, { accept: "text/event-stream" }),
    );
    close.push(live.stop);
    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    close.push(history.stop);
    await waitFor(() => machine.calls("/history-lines").length === 1 && live.has("ping"));
    const [first] = machine.calls("/history-lines");
    const [session] = machine.calls("/stream");

    clock.advance(MACHINE_STREAM_WATCHDOG_MS);
    // The cut stream brought nothing but its window: asked again after the first wait.
    await waitFor(() => progressOf(history.events).some((p) => p.waiting?.attempt === 1));
    clock.advance(1_000);
    await waitFor(() => history.has("done"));

    expect(machine.cancelled(first!)).toBe(true);
    expect(machine.calls("/history-lines")).toHaveLength(2);
    expect(machine.cancelled(session!)).toBe(false);
    expect(windowRecords(history.events)).toEqual(
      FILE.trim()
        .split("\n")
        .map((l, ordinal) => ({
          ...(JSON.parse(l) as object),
          tracePosition: { fileIndex: 1, ordinal },
        })),
    );
  });

  it("keeps a stream whose large frame is still crossing the link, its bytes heard though no event is whole", async () => {
    let valve: Awaited<ReturnType<typeof valveTo>> | null = null;
    // A window frame far larger than what a slow link carries in one watchdog (as an older
    // machine sends it, whole; the extra field is nothing the hub reads).
    const padded = { ...windowOf(FILE), pad: "p".repeat(300_000) };
    const machine = await scriptedMachine((ws, id) => {
      valve!.shut();
      start(ws, id);
      event(ws, id, "window", padded);
      event(ws, id, "lines", { k: K, off: 0, ord: 0, text: FILE });
      event(ws, id, "ready", {});
      event(ws, id, "done", {});
      send(ws, { id, end: true, reason: "closed" });
    });
    close.push(machine.close);
    valve = await valveTo(machine.port);
    close.push(valve.close);
    let heard = 0;
    const { get } = hub(valve.port, {
      onSocket: (socket) => void socket.onTraffic(() => (heard += 1)),
    });

    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    close.push(history.stop);
    await waitFor(() => valve!.held() > 300_000);
    valve.release(1_000);
    await waitFor(() => heard > 0);
    clock.advance(10_000);
    const before = heard;
    valve.release(100_000);
    await waitFor(() => heard > before);
    // Past the watchdog since the last whole event, but not since the last byte.
    clock.advance(6_000);
    valve.open();
    await waitFor(() => history.has("done"));
    expect(machine.calls("/history-lines")).toHaveLength(1);
  });

  /**
   * A machine whose history stream sends its window and then nothing until `release`, and whose
   * HTTP side answers one long request a piece at a time, as the test says: a proxied answer
   * taking the machine's whole link while the stream behind it on the socket hears nothing.
   */
  async function busyLink() {
    let released: (() => void) | null = null;
    let historyCalls = 0;
    let answer: http.ServerResponse | null = null;
    const machine = await scriptedMachine(
      (ws, id, callPath) => {
        if (!callPath.includes("/history-lines")) return;
        historyCalls += 1;
        if (historyCalls > 1) {
          answerWindow(ws, id);
          return;
        }
        start(ws, id);
        event(ws, id, "window", windowOf(FILE));
        released = () => {
          event(ws, id, "lines", { k: K, off: 0, ord: 0, text: FILE });
          event(ws, id, "ready", {});
          event(ws, id, "done", {});
          send(ws, { id, end: true, reason: "closed" });
        };
      },
      (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.write("[");
        answer = res;
      },
    );
    close.push(machine.close);
    const links = new LinkActivity(clock.now);
    const logged: string[] = [];
    const { get } = hub(machine.port, { links, log: (line) => logged.push(line) });
    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    close.push(history.stop);
    await waitFor(() => released !== null && links.heardAt(MACHINE) !== null);
    const models = await get("/api/projects/default_project/models");
    await waitFor(() => answer !== null);
    // The long answer, read as the page reads it: a piece has crossed once it is read.
    const body = models.body!.getReader();
    let read = 0;
    let sent = 1;
    const readTo = async (bytes: number) => {
      while (read < bytes) read += (await body.read()).value?.length ?? Number.POSITIVE_INFINITY;
    };
    close.push(async () => {
      answer?.end("]");
      await body.cancel();
    });
    await readTo(sent);
    return {
      machine,
      history,
      models,
      /** One more piece of the long answer crosses the link at the clock's now. */
      piece: async () => {
        const piece = `"${"m".repeat(1_000)}",`;
        answer!.write(piece);
        sent += piece.length;
        await readTo(sent);
        expect(links.heardAt(MACHINE)).toBe(clock.now());
      },
      release: () => released!(),
      waited: () => progressOf(history.events).some((p) => p.waiting !== null),
      /** The streams the watchdog has cut (it says so as it cuts, before anything else moves). */
      cuts: () =>
        logged.filter((line) => line.includes(`nothing in ${MACHINE_STREAM_WATCHDOG_MS} ms`))
          .length,
    };
  }

  it("keeps a stream that hears nothing while another connection's answer still crosses the machine's link", async () => {
    const link = await busyLink();

    // Twenty seconds without a byte on the stream's own socket, past its watchdog, while the
    // link carries the other answer the whole time.
    for (let i = 0; i < 4; i += 1) {
      await link.piece();
      clock.advance(5_000);
    }
    expect(link.cuts()).toBe(0);
    link.release();
    await waitFor(() => link.history.has("done"));

    expect(link.waited()).toBe(false);
    expect(link.machine.calls("/history-lines")).toHaveLength(1);
    expect(windowRecords(link.history.events)).toHaveLength(2);
    expect(link.models.status).toBe(200);
  });

  it("asks again once nothing at all came from the machine for the watchdog, counted from the link's last byte", async () => {
    const link = await busyLink();
    await link.piece();
    clock.advance(5_000);
    await link.piece();

    // The link went quiet five seconds after the stream's last event: still alive at 15 s from
    // that event, cut at 15 s from the link's last byte, and asked again after the first wait.
    clock.advance(MACHINE_STREAM_WATCHDOG_MS - 1);
    expect(link.cuts()).toBe(0);
    clock.advance(1);
    expect(link.cuts()).toBe(1);
    const [first] = link.machine.calls("/history-lines");
    await waitFor(() => link.waited());
    expect(progressOf(link.history.events).at(-1)?.waiting).toMatchObject({ attempt: 1 });
    clock.advance(1_000);
    await waitFor(() => link.history.has("done"));
    expect(link.machine.cancelled(first!)).toBe(true);
    expect(link.machine.calls("/history-lines")).toHaveLength(2);
  });

  it("keeps nothing of bytes past the end the machine gave their file, and asks again after a wait", async () => {
    let calls = 0;
    const machine = await scriptedMachine((ws, id) => {
      calls += 1;
      if (calls > 1) {
        answerWindow(ws, id);
        return;
      }
      start(ws, id);
      event(ws, id, "window", windowOf(FILE));
      event(ws, id, "lines", { k: K, off: 0, ord: 0, text: FILE + traceLine(2, "past the end") });
    });
    close.push(machine.close);
    const { get, cache } = hub(machine.port);

    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    close.push(history.stop);
    await waitFor(() => progressOf(history.events).some((p) => p.waiting?.attempt === 1));
    expect(cache.usedBytes).toBe(0);
    clock.advance(1_000);
    await waitFor(() => history.has("done"));
    expect(cache.usedBytes).toBe(Buffer.byteLength(FILE));
    expect(windowRecords(history.events)).toHaveLength(2);
  });

  it("asks again after a wait when a window's parts outgrow any window", async () => {
    let calls = 0;
    const machine = await scriptedMachine((ws, id) => {
      calls += 1;
      if (calls > 1) {
        answerWindow(ws, id);
        return;
      }
      start(ws, id);
      for (let i = 0; i < 3; i += 1)
        event(ws, id, "window-part", { text: "w".repeat(600), last: false });
    });
    close.push(machine.close);
    const { get } = hub(machine.port, { windowTextMax: 1_000 });

    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    close.push(history.stop);
    await waitFor(() => progressOf(history.events).some((p) => p.waiting?.attempt === 1));
    clock.advance(1_000);
    await waitFor(() => history.has("done"));
    expect(machine.calls("/history-lines")).toHaveLength(2);
  });

  it("hears a socket's bytes for any number of streams with one listener on its connection", async () => {
    const machine = await scriptedMachine((ws, id) => {
      start(ws, id);
      event(ws, id, "ping", {});
    });
    close.push(machine.close);
    const got = await sockets.socketFor(MACHINE, {
      agent: new http.Agent(),
      port: machine.port,
      cookie: "c",
      session: 1,
    });
    if (!("socket" in got)) throw new Error("no socket");
    const warnings: Error[] = [];
    const warned = (warning: Error) => warnings.push(warning);
    process.on("warning", warned);
    close.push(() => void process.off("warning", warned));
    let heard = 0;
    for (let i = 0; i < 20; i += 1) got.socket.onTraffic(() => (heard += 1));

    got.socket.call(
      { method: "GET", path: "/api/events", headers: { accept: "text/event-stream" } },
      {
        onStart: () => undefined,
        onEvent: () => undefined,
        onEnd: () => undefined,
        onResponse: () => undefined,
      },
    );
    await waitFor(() => heard >= 20);
    await new Promise((resolve) => setImmediate(resolve));
    expect(warnings.filter((w) => w.name === "MaxListenersExceededWarning")).toEqual([]);
  });

  /** A socket to `port` from sockets of their own, dropped after `SILENCE` ms of nothing. */
  const SILENCE = 400;
  async function slowSocket(port: number, links?: LinkActivity) {
    const own = new MachineSockets(() => undefined, {
      silenceMs: SILENCE,
      ...(links !== undefined ? { heardAt: (id: string) => links.heardAt(id) } : {}),
    });
    close.push(() => own.close());
    const got = await own.socketFor(MACHINE, {
      agent: new http.Agent(),
      port,
      cookie: "c",
      session: 1,
    });
    if (!("socket" in got)) throw new Error("no socket");
    let closedAt: number | null = null;
    got.socket.onClose(() => (closedAt ??= Date.now()));
    return { socket: got.socket, closedAt: () => closedAt };
  }
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("keeps a machine's socket up while one message trickles in past its silence, telling the machine it hears it, and drops it after true silence", async () => {
    let valve: Awaited<ReturnType<typeof valveTo>> | null = null;
    const machine = await scriptedMachine((ws, id) => {
      valve!.shut();
      start(ws, id);
      event(ws, id, "window", { pad: randomBytes(45_000).toString("base64") });
    });
    close.push(machine.close);
    valve = await valveTo(machine.port);
    close.push(valve.close);
    const { socket, closedAt } = await slowSocket(valve.port);
    const events: string[] = [];
    socket.call(
      { method: "GET", path: "/api/slow", headers: { accept: "text/event-stream" } },
      {
        onStart: () => undefined,
        onEvent: (frame) => void events.push(frame.event),
        onEnd: () => undefined,
        onResponse: () => undefined,
      },
    );
    await waitFor(() => valve!.held() > 60_000);

    // About 60 KB at 1 KB per 30 ms: some four silence periods with no whole message.
    const began = Date.now();
    while (valve.held() > 0) {
      valve.release(1_000);
      await pause(30);
    }
    const lastByte = Date.now();
    await waitFor(() => events.length === 1);
    expect(lastByte - began).toBeGreaterThan(3 * SILENCE);
    expect(closedAt()).toBeNull();
    expect(machine.pings()).toBeGreaterThan(0);

    await waitFor(() => closedAt() !== null, 4 * SILENCE);
    expect(closedAt()! - lastByte).toBeGreaterThanOrEqual(SILENCE - 50);
  }, 15_000);

  it("keeps a machine's socket up on another connection's bytes for a while, and drops it once its own channel has been silent twice the period, however busy the link", async () => {
    const machine = await scriptedMachine(() => undefined);
    close.push(machine.close);
    const valve = await valveTo(machine.port);
    close.push(valve.close);
    const links = new LinkActivity();
    const { closedAt } = await slowSocket(valve.port, links);
    // Nothing more comes back on the socket's own connection, not even an answer to a ping;
    // the rest of the link stays busy throughout.
    valve.shut();
    const shut = Date.now();
    let busy = true;
    void (async () => {
      while (busy) {
        links.heard(MACHINE);
        await pause(50);
      }
    })();
    close.push(() => {
      busy = false;
    });

    await pause(1.5 * SILENCE);
    expect(closedAt()).toBeNull();
    await waitFor(() => closedAt() !== null, 4 * SILENCE);
    expect(closedAt()! - shut).toBeGreaterThanOrEqual(2 * SILENCE - 50);
    busy = false;
  }, 15_000);

  it("tells the reader the machine is slow when its stream carries only beats for a minute, and goes on", async () => {
    let carry: ((name: string, data: unknown) => void) | null = null;
    const machine = await scriptedMachine((ws, id) => {
      start(ws, id);
      event(ws, id, "window", windowOf(FILE));
      carry = (name, data) => event(ws, id, name, data);
    });
    close.push(machine.close);
    let bytes = 0;
    const { get } = hub(machine.port, {
      onSocket: (socket) => void socket.onTraffic(() => (bytes += 1)),
    });
    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    close.push(history.stop);
    await waitFor(() => carry !== null);
    const beat = async () => {
      const before = bytes;
      carry!("ping", {});
      await waitFor(() => bytes > before);
    };
    const slow = () => progressOf(history.events).some((p) => p.waiting?.reason === "slow");

    // A route stuck over there: beats every five seconds, nothing else.
    for (let at = 0; at < MACHINE_STREAM_STALL_MS - 5_000; at += 5_000) {
      clock.advance(5_000);
      await beat();
    }
    expect(slow()).toBe(false);
    clock.advance(5_000);
    await beat();
    await waitFor(() => slow());

    carry!("lines", { k: K, off: 0, ord: 0, text: FILE });
    carry!("ready", {});
    carry!("done", {});
    await waitFor(() => history.has("done"));
    expect(progressOf(history.events).at(-1)?.waiting ?? null).toBeNull();
    expect(machine.calls("/history-lines")).toHaveLength(1);
  });

  it("asks the machine whether a Session the copy answers for is still there at most once a while, and drops it once the machine says it is gone", async () => {
    let said: "there" | "gone" = "there";
    let asked = 0;
    const machine = await scriptedMachine(answerWindow, (req, res) => {
      if (req.url !== `/api/sessions/${SID}`) {
        res.statusCode = 404;
        res.end();
        return;
      }
      asked += 1;
      res.setHeader("content-type", "application/json");
      if (said === "there") {
        res.end(JSON.stringify({ session: { sessionId: SID, projectId: "default_project" } }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { code: "session_not_found", message: "No." } }));
      }
    });
    close.push(machine.close);
    let connected = true;
    const { get, cache } = hub(machine.port, { connected: () => connected });
    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    await history.finished;
    const events = `/api/sessions/${SID}/traces/1?offset=0&limit=2`;

    expect((await get(events)).status).toBe(200);
    expect((await get(events)).status).toBe(200);
    expect(asked).toBe(1);
    clock.advance(SESSION_CONFIRM_TTL_MS);
    expect((await get(events)).status).toBe(200);
    expect(asked).toBe(2);

    // Away: the copy's last word stands, and nothing is asked.
    connected = false;
    clock.advance(SESSION_CONFIRM_TTL_MS);
    expect((await get(events)).status).toBe(200);
    expect(asked).toBe(2);

    // Deleted over there, with nothing heard of it here: the next read finds out.
    connected = true;
    said = "gone";
    const gone = await get(events);
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { error: { code: string } }).error.code).toBe(
      "session_not_found",
    );
    await waitFor(() => cache.usedBytes === 0);
  });

  it("cancels the machine's call the moment its last reader leaves, even in the middle of the fill", async () => {
    const machine = await scriptedMachine((ws, id) => {
      // The window, then a fill that never ends.
      start(ws, id);
      event(ws, id, "window", {
        ...windowOf(FILE),
        totals: { ...windowOf(FILE).totals, fill: { bytes: 1_000_000, lines: 100 } },
      });
      event(ws, id, "lines", { k: K, off: 0, ord: 0, text: FILE });
      event(ws, id, "ready", {});
    });
    close.push(machine.close);
    const { get } = hub(machine.port);

    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20&fill=1`));
    await waitFor(() => history.has("done"));
    const [call] = machine.calls("/history-lines");
    expect(new URL(machine.frames[0]!.call!.path, "http://x").searchParams.get("fill")).toBe("1");
    expect(machine.cancelled(call!)).toBe(false);

    await history.stop();
    await waitFor(() => machine.cancelled(call!));
  });

  it("runs one machine call at a time, and a reader leaving mid-window lets the next one's go", async () => {
    let historyCalls = 0;
    const machine = await scriptedMachine((ws, id) => {
      historyCalls += 1;
      if (historyCalls === 1) {
        start(ws, id);
        event(ws, id, "window", windowOf(FILE));
        return;
      }
      answerWindow(ws, id);
    });
    close.push(machine.close);
    const { get } = hub(machine.port);

    const leaving = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    await waitFor(() => machine.calls("/history-lines").length === 1);
    const staying = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=5`));
    close.push(staying.stop);
    const [first] = machine.calls("/history-lines");
    expect(machine.calls("/history-lines")).toHaveLength(1);

    await leaving.stop();
    await waitFor(() => staying.has("done"));
    expect(machine.cancelled(first!)).toBe(true);
    const calls = machine.frames.filter((f) => f.call?.path.includes("/history-lines"));
    expect(
      calls.map((f) => new URL(f.call!.path, "http://x").searchParams.get("tailLimit")),
    ).toEqual(["20", "5"]);
  });

  it("tells the reader it waits for a machine that is away, and delivers once it is back", async () => {
    let connected = false;
    const machine = await scriptedMachine(answerWindow);
    close.push(machine.close);
    const { get } = hub(machine.port, { connected: () => connected });

    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    close.push(history.stop);
    await waitFor(() => progressOf(history.events).some((p) => p.waiting?.attempt === 1));
    expect(progressOf(history.events).at(-1)?.waiting).toEqual({
      reason: "not_connected",
      attempt: 1,
      nextAt: clock.now() + 1_000,
    });

    clock.advance(1_000);
    await waitFor(() => progressOf(history.events).some((p) => p.waiting?.attempt === 2));
    expect(progressOf(history.events).at(-1)?.waiting?.nextAt).toBe(clock.now() + 2_000);
    expect(machine.calls("/history-lines")).toEqual([]);

    connected = true;
    clock.advance(2_000);
    await waitFor(() => history.has("done"));
    expect(
      history
        .named()
        .map((e) => e.event)
        .slice(-3),
    ).toEqual(["page", "records", "done"]);
  });

  it("reads an older machine's window from its /messages over HTTP, counting the bytes", async () => {
    const messages = FILE.trim()
      .split("\n")
      .map((l, ordinal) => ({
        ...(JSON.parse(l) as object),
        tracePosition: { fileIndex: 1, ordinal },
      }));
    const body = JSON.stringify({
      messages,
      page: {
        earlierTurns: 0,
        prior: {
          subagentTokens: 0,
          elapsedMs: 0,
          apiMs: 0,
          toolMs: 0,
          sessionTokens: 0,
          contextTokens: 0,
        },
      },
    });
    const asked: string[] = [];
    const machine = await scriptedMachine(
      (ws, id) =>
        send(ws, {
          id,
          status: 421,
          headers: {},
          body: {
            error: { code: "not_on_socket", message: "This endpoint is served over HTTP only." },
          },
        }),
      (req, res) => {
        asked.push(req.url ?? "");
        res.setHeader("content-type", "application/json");
        res.setHeader("content-length", Buffer.byteLength(body));
        res.end(body);
      },
    );
    close.push(machine.close);
    const { get } = hub(machine.port);

    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    close.push(history.stop);
    await waitFor(() => history.has("done"));

    expect(asked).toEqual([`/api/sessions/${SID}/messages?tailLimit=20`]);
    expect(progressOf(history.events).at(-1)).toMatchObject({
      phase: "window",
      doneBytes: Buffer.byteLength(body),
      totalBytes: Buffer.byteLength(body),
    });
    expect(windowRecords(history.events)).toEqual(messages);
  });

  it("says how many Tasks an older machine's window holds, its own page saying none", async () => {
    // Three Tasks, then an input the machine holds that its Trace has not caught up to.
    const lines = [0, 1, 2].flatMap((i) => [
      traceLine(2 * i, `question ${i}`, "user"),
      traceLine(2 * i + 1, `answer ${i}`),
    ]);
    const held = JSON.parse(traceLine(6, "and one more", "user")) as object;
    const body = JSON.stringify({
      messages: [
        ...lines.map((l, ordinal) => ({
          ...(JSON.parse(l) as object),
          tracePosition: { fileIndex: 1, ordinal },
        })),
        held,
      ],
      page: {
        earlierTurns: 4,
        prior: {
          subagentTokens: 0,
          elapsedMs: 0,
          apiMs: 0,
          toolMs: 0,
          sessionTokens: 0,
          contextTokens: 0,
        },
      },
    });
    const machine = await scriptedMachine(
      (ws, id) =>
        send(ws, {
          id,
          status: 421,
          headers: {},
          body: { error: { code: "not_on_socket", message: "HTTP only." } },
        }),
      (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(body);
      },
    );
    close.push(machine.close);
    const { get } = hub(machine.port);

    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=3`));
    close.push(history.stop);
    await waitFor(() => history.has("done"));

    const page = JSON.parse(history.events.find((e) => e.event === "page")!.data) as {
      page: { units: number; earlierTurns: number };
    };
    expect(page.page).toMatchObject({ units: 3, earlierTurns: 4 });
  });

  it("counts inputs held behind a running Task's prompt with that Task on an older page that marks no record", async () => {
    // A build older than trace positions: three Tasks, the third running, two inputs held behind it.
    const records = [0, 1, 2]
      .flatMap((i) => [
        traceLine(2 * i, `question ${i}`, "user"),
        traceLine(2 * i + 1, `answer ${i}`),
      ])
      .slice(0, 5)
      .concat([traceLine(6, "held one", "user"), traceLine(7, "held two", "user")])
      .map((line) => JSON.parse(line) as object);
    const body = JSON.stringify({
      messages: records,
      live: { cursor: "7", fragments: [] },
      page: {
        earlierTurns: 0,
        prior: {
          subagentTokens: 0,
          elapsedMs: 0,
          apiMs: 0,
          toolMs: 0,
          sessionTokens: 0,
          contextTokens: 0,
        },
      },
    });
    const machine = await scriptedMachine(
      (ws, id) =>
        send(ws, {
          id,
          status: 421,
          headers: {},
          body: { error: { code: "not_on_socket", message: "HTTP only." } },
        }),
      (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(body);
      },
    );
    close.push(machine.close);
    const { get } = hub(machine.port);

    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=3`));
    close.push(history.stop);
    await waitFor(() => history.has("done"));
    const page = JSON.parse(history.events.find((e) => e.event === "page")!.data) as {
      page: { units: number };
    };
    expect(page.page.units).toBe(3);
  });

  it.each([
    ["has no socket to offer this server", "machine_socket_unavailable", 502],
    ["is on a build this hub cannot bring it to", "machine_incompatible", 502],
  ])("reads the window over HTTP from a machine that %s", async (_name, code, status) => {
    const body = JSON.stringify({
      messages: [],
      page: {
        earlierTurns: 0,
        prior: {
          subagentTokens: 0,
          elapsedMs: 0,
          apiMs: 0,
          toolMs: 0,
          sessionTokens: 0,
          contextTokens: 0,
        },
      },
    });
    const machine = await scriptedMachine(answerWindow, (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(body);
    });
    close.push(machine.close);
    const { get } = hub(machine.port, {
      refusal: () => Response.json({ error: { code, message: "no socket" } }, { status }),
    });
    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    close.push(history.stop);
    await waitFor(() => history.has("done"));
    expect(machine.calls("/history-lines")).toEqual([]);
  });

  it("ends the stream with machine_refused when the machine turns this server's session away", async () => {
    const { get } = hub(1, {
      refusal: () =>
        Response.json(
          {
            error: {
              code: "machine_socket_refused",
              message: "m answered the API socket handshake with 401; update the program on it",
            },
          },
          { status: 502 },
        ),
    });
    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    await history.finished;
    const last = history.named().at(-1)!;
    expect(last.event).toBe("error");
    expect((JSON.parse(last.data) as { code: string }).code).toBe("machine_refused");
  });

  it("tells the reader it waits while the machine is brought onto this hub's build", async () => {
    let upgrading = true;
    const machine = await scriptedMachine(answerWindow);
    close.push(machine.close);
    const { get } = hub(machine.port, {
      refusal: () =>
        upgrading
          ? Response.json(
              { error: { code: "machine_upgrading", message: "installing" } },
              { status: 503 },
            )
          : null,
    });
    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    close.push(history.stop);
    await waitFor(() => progressOf(history.events).some((p) => p.waiting?.reason === "retrying"));
    upgrading = false;
    clock.advance(1_000);
    await waitFor(() => history.has("done"));
  });

  it("ends the stream with machine_not_found for a machine this server no longer lists", async () => {
    const { get } = hub(1, { connected: () => false, known: () => false });
    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    await history.finished;
    const last = history.named().at(-1)!;
    expect(last.event).toBe("error");
    expect((JSON.parse(last.data) as { code: string }).code).toBe("machine_not_found");
  });

  it("asks a machine stream that keeps ending without moving again only after a wait it tells of", async () => {
    let calls = 0;
    const machine = await scriptedMachine((ws, id) => {
      calls += 1;
      start(ws, id);
      event(ws, id, "window", windowOf(FILE));
      send(ws, { id, end: true, reason: "closed" });
    });
    close.push(machine.close);
    const { get } = hub(machine.port);
    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    close.push(history.stop);
    await waitFor(() => progressOf(history.events).some((p) => p.waiting?.attempt === 1));
    expect(calls).toBe(1);
    expect(progressOf(history.events).at(-1)?.waiting).toMatchObject({
      reason: "retrying",
      attempt: 1,
    });

    clock.advance(1_000);
    await waitFor(() => progressOf(history.events).some((p) => p.waiting?.attempt === 2));
    expect(calls).toBe(2);
  });

  it("delivers the window from the stream itself when the copy cannot be written", async () => {
    let calls = 0;
    const machine = await scriptedMachine((ws, id) => {
      calls += 1;
      answerWindow(ws, id);
    });
    close.push(machine.close);
    // A file where the copy's directory should be: nothing of the copy can open or write.
    const blocked = path.join(root, "blocked");
    await fs.writeFile(blocked, "not a directory");
    const { get } = hub(machine.port, { cache: new TraceCache(path.join(blocked, "traces")) });
    const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20&fill=1`));
    await history.finished;

    expect(
      history
        .named()
        .map((e) => e.event)
        .filter((e) => e !== "progress"),
    ).toEqual(["page", "records", "done", "filled"]);
    expect(windowRecords(history.events)).toHaveLength(2);
    expect(calls).toBe(1);
  });

  it("ends every stream of a replaced generation without an error, and any asked of it afterwards", async () => {
    const { get, sync } = hub(1, { connected: () => false });
    const waiting = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    await waitFor(() => progressOf(waiting.events).some((p) => p.waiting?.attempt === 1));

    sync.close();
    await waiting.finished;
    expect(waiting.named().map((e) => e.event)).toEqual(["progress"]);

    const late = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
    await late.finished;
    expect(late.named()).toEqual([]);
  });

  it("cancels a fill another reader's window stream carries once its last fill reader leaves, its owner still there", async () => {
    // A window larger than the owner's reader takes in at once: its route is still sending it.
    const big = Array.from({ length: 300 }, (_, i) =>
      traceLine(i, `${i} ${"b".repeat(1_000)}`),
    ).join("");
    const answered: string[] = [];
    const machine = await scriptedMachine((ws, id, callPath) => {
      answered.push(callPath);
      start(ws, id);
      // A fill that never ends; the window call also gets its window first.
      event(ws, id, "window", {
        ...windowOf(big),
        totals: { ...windowOf(big).totals, fill: { bytes: 1_000_000, lines: 100 } },
      });
      if (callPath.includes("tailLimit")) {
        event(ws, id, "lines", { k: K, off: 0, ord: 0, text: big });
        event(ws, id, "ready", {});
      }
    });
    close.push(machine.close);
    const { get } = hub(machine.port);

    const filler = eventReader(await get(`/api/sessions/${SID}/history?fill=only`));
    await waitFor(() => machine.calls("/history-lines").length === 1);
    // The owner asks its window and never reads it: it stays attached, its records unsent.
    const owner = await get(`/api/sessions/${SID}/history?tailLimit=20`);
    close.push(() => owner.body?.cancel());
    await waitFor(() => machine.calls("/history-lines").length === 2);
    const [, carrying] = machine.calls("/history-lines");
    // Delivered: the hub has handled the window, its lines and `ready`.
    await waitFor(
      () => machine.frames.filter((f) => f.id === carrying && f.ack !== undefined).length >= 3,
    );
    expect(new URL(answered[1]!, "http://x").searchParams.get("fill")).toBe("1");
    expect(machine.cancelled(carrying!)).toBe(false);

    await filler.stop();
    await waitFor(() => machine.cancelled(carrying!));
  });

  it("keeps an open job's Session when the copy is over its cap, and lets one no job holds go", async () => {
    let t = 0;
    const machine = await scriptedMachine((ws, id, callPath) => {
      const sid = sessionOf(callPath);
      if (sid !== "s-open") return answerWindow(ws, id, callPath);
      const k = `default_agent/${sid}/1`;
      start(ws, id);
      event(ws, id, "window", {
        ...windowOf(FILE, k),
        totals: { ...windowOf(FILE, k).totals, fill: { bytes: 10, lines: 1 } },
      });
      event(ws, id, "lines", { k, off: 0, ord: 0, text: FILE });
      event(ws, id, "ready", {});
    });
    close.push(machine.close);
    const cache = new TraceCache(path.join(root, "copy"), {
      capBytes: Math.floor(Buffer.byteLength(FILE) * 2.5),
      now: () => ++t,
    });
    const { get } = hub(machine.port, { cache });
    const read = async (sid: string) => {
      const reader = eventReader(await get(`/api/sessions/${sid}/history?tailLimit=20`));
      await reader.finished;
    };

    // Read first, so read longest ago — but its job stays open, waiting for its fill.
    const open = eventReader(await get(`/api/sessions/s-open/history?tailLimit=20&fill=1`));
    close.push(open.stop);
    await waitFor(() => open.has("done"));
    await read("s-done");
    await read("s-last");

    // Evicted once the last stream completed, while the open job's Session is held.
    const deadline = Date.now() + 2_000;
    while ((await cache.bytes(MACHINE, "default_agent/s-done/1", 0, 1)) !== null) {
      if (Date.now() > deadline) throw new Error("the Session no job holds was never evicted");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await cache.bytes(MACHINE, "default_agent/s-open/1", 0, 1)).not.toBeNull();
  });
  it("loads a Session with many subagents on every open, its `have` within what the machine takes", async () => {
    // The machine's ceiling, scaled down with the copy's budget: 150 files of held runs pass it.
    const ceiling = 20_000;
    const children = Array.from(
      { length: 150 },
      (_, i) => `session-2026-10-29-09-00-01-${String(i).padStart(8, "0")}`,
    );
    const childFile = traceLine(0, "child answer");
    const opened: string[] = [];
    const machine = await scriptedMachine((ws, id, callPath) => {
      // As the machine does: a `have` past its ceiling, or one it cannot decode, is a 400.
      const have = new URL(callPath, "http://x").searchParams.get("have");
      if (have !== null && (have.length > ceiling || decodeHistoryHave(have) === null)) {
        send(ws, {
          id,
          status: 400,
          headers: {},
          body: { error: { code: "bad_request", message: "have" } },
        });
        opened.push("refused");
        return;
      }
      opened.push("served");
      const window = windowOf(FILE);
      window.files = [
        ...window.files,
        ...children.map((child) => ({
          k: `default_agent/${child}/1`,
          ino: "21",
          birthtimeMs: 5,
          size: Buffer.byteLength(childFile),
          records: 1,
          final: true,
        })),
      ];
      start(ws, id);
      event(ws, id, "window", window);
      event(ws, id, "lines", { k: K, off: 0, ord: 0, text: FILE });
      for (const child of children) {
        event(ws, id, "lines", { k: `default_agent/${child}/1`, off: 0, ord: 0, text: childFile });
      }
      event(ws, id, "ready", {});
      event(ws, id, "done", {});
      send(ws, { id, end: true, reason: "closed" });
    });
    close.push(machine.close);
    const { get } = hub(machine.port, {
      cache: new TraceCache(path.join(root, "copy"), { haveBudgetChars: ceiling - 1_000 }),
    });
    for (let open = 0; open < 3; open++) {
      const history = eventReader(await get(`/api/sessions/${SID}/history?tailLimit=20`));
      await history.finished;
      expect(history.named().at(-1)?.event).toBe("done");
    }
    expect(opened).toEqual(["served", "served", "served"]);
  });
});
