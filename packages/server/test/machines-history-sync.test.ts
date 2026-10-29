/**
 * A machine Session's history on the hub when the machine's leg misbehaves: the machine is a
 * scripted API socket (the boundary this suite fakes), the reader asks through the
 * `/server/<id>` proxy as the Web App does, and the sync job's timers run on a clock the test
 * moves (machines/history-sync.ts, history-routes.ts).
 *
 * - Given a machine stream that falls silent — no frame, not even its beat — when the
 *   watchdog's time passes, then that call alone is cancelled and asked again, a Session stream
 *   on the same socket keeps its subscription, and the call asked again delivers the window.
 * - Given a reader that leaves while its window is on the way, then the machine's call is
 *   cancelled at once.
 * - Given a machine that is not connected, when a window is asked for, then the reader is told
 *   it waits — the attempt, and when the next one is — and the window arrives once it is back.
 * - Given a machine on an older build (its socket answers `history-lines` 421), then the window
 *   is read from its `/messages` over HTTP inside the same stream, the bytes counted as they come.
 */
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { HistoryLinesWindow, HistoryProgress } from "../src/api/types.js";
import { machineHistory } from "../src/machines/history-routes.js";
import { MachineSockets } from "../src/machines/machine-sockets.js";
import { machinesProxy } from "../src/machines/proxy.js";
import type { ProxyTarget } from "../src/machines/proxy.js";
import { TraceCache } from "../src/machines/trace-cache.js";
import { MACHINE_STREAM_WATCHDOG_MS } from "../src/machines/history-sync.js";
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
  wss.on("connection", (ws) => {
    sockets.push(ws);
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
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of sockets) ws.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

const send = (ws: WebSocket, frame: object) => ws.send(JSON.stringify(frame));
const start = (ws: WebSocket, id: number) =>
  send(ws, { id, status: 200, stream: true, headers: {} });
const event = (
  ws: WebSocket,
  id: number,
  name: string,
  data: unknown,
  eventId: string | null = null,
) => send(ws, { id, event: name, eventId, data: JSON.stringify(data) });

/** The window event of a one-file Session whose whole file is the window. */
const windowOf = (file: string): HistoryLinesWindow => ({
  envelope: {
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
    pendingInputs: [],
    serverNowMs: 1_700_000_000_000,
    status: "idle",
  },
  files: [
    { k: K, ino: 11, birthtimeMs: 5, size: Buffer.byteLength(file), records: 2, final: false },
  ],
  layout: [{ k: K, from: [0, 0], to: [Buffer.byteLength(file), 2], origin: null }],
  stubs: [],
  totals: {
    window: { bytes: Buffer.byteLength(file), lines: 2 },
    heavy: { bytes: 0, lines: 0 },
    fill: { bytes: 0, lines: 0 },
  },
});

/** The whole answer of a healthy machine to one window call. */
function answerWindow(ws: WebSocket, id: number): void {
  start(ws, id);
  event(ws, id, "window", windowOf(FILE));
  event(ws, id, "lines", { k: K, off: 0, ord: 0, text: FILE });
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
function hub(port: number, connected: () => boolean = () => true) {
  const target = (): ProxyTarget | null =>
    connected()
      ? { agent: new http.Agent(), port, cookie: "c", adoptedAt: null, session: 1 }
      : null;
  const { history, sync } = machineHistory({
    cache: new TraceCache(path.join(root, "machines", "traces")),
    sockets,
    target: async () => target(),
    log: () => undefined,
    tuning: { clock },
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
  return { get };
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
    const { get } = hub(machine.port, () => connected);

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
});
