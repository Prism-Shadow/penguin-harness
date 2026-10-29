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
import fs from "node:fs/promises";
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
import { decodeHistoryHave } from "../src/services/history-wire.js";
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
  } = {},
) {
  const connected = options.connected ?? (() => true);
  const target = (): ProxyTarget | null =>
    connected()
      ? { agent: new http.Agent(), port, cookie: "c", adoptedAt: null, session: 1 }
      : null;
  const cache = options.cache ?? new TraceCache(path.join(root, "machines", "traces"));
  const refusal = options.refusal;
  const { history, sync } = machineHistory({
    cache,
    sockets:
      refusal === undefined
        ? sockets
        : {
            socketFor: async (machineId, at) => {
              const answer = refusal();
              return answer !== null ? { answer } : sockets.socketFor(machineId, at);
            },
          },
    target: async () => target(),
    ...(options.known !== undefined ? { known: options.known } : {}),
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
