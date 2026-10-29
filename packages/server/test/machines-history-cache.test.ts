/**
 * A machine Session's history through the hub with nothing scripted on the way: the machine is a
 * real server App behind its runtime's upgrade seam, reached through a TCP link the test can cut,
 * and the hub's copy of its Trace lines lives under a temp directory (machines/history-sync.ts,
 * trace-cache.ts, history-routes.ts).
 *
 * - Given a window read through the hub, then its progress counts up to a total that does not
 *   move, then come its page, records and done — the records the machine's own `/messages`
 *   answers, elided — and the hub's copy of the file equals the machine's, byte for byte.
 * - Given three records appended on the machine, when the conversation is opened again, then
 *   the machine sends exactly those three lines; and a Session held whole, reopened the way the
 *   chat opens it (a budgeted first window, the window before it, the fill) after one more Task,
 *   is sent only that Task's lines.
 * - Given the link cut mid-transfer, inside a line sent in parts, then the job reopens from what
 *   it holds: the copy equals the machine's file byte for byte, and the bytes that crossed over
 *   both streams exceed the file by at most one frame.
 * - Given the machine's file rewritten in place (same size, other bytes), or replaced by a new
 *   one, when the conversation is opened again, then the copy starts over and equals the file
 *   as it is now; a subagent's file deleted on the machine leaves no copy behind.
 * - Given `fill=1` over a Session longer than its window, then after `done` the fill's
 *   progress follows and `filled` ends the stream, with the whole Session held.
 * - Given a rotated file the copy holds whole, then the Trace panel's events and an image by
 *   reference are answered from it, even with the machine away; the live file's events are the
 *   machine's (it grows there), and whatever the copy cannot answer is forwarded.
 * - Given a value the window elided, then `trace-body` sends it whole: the first time after
 *   fetching its one line, its progress counted once in one total, the next time from the copy
 *   alone.
 * - Given the conversation opened by its URL alone (no machine prefix, as a reload asks), then
 *   the hub's Session forward answers it with the same stream, its copy under the hub's root; the
 *   Trace panel's Project-scoped events are then answered from the copy for that Session's
 *   Project and find nothing under another; and its HTTP stream ends when its user is signed out.
 * - Given a line held below the newest run (a body fetched), then the fill does not send it again.
 * - Given a fill cut inside the first line it sends of a file, then it resumes from what it held.
 * - Given a reader that leaves mid-fill and comes back, then only what was not brought crosses.
 */
import fs from "node:fs/promises";
import http from "node:http";
import type { Server as HttpServer } from "node:http";
import net from "node:net";
import type { Socket } from "node:net";
import path from "node:path";
import { serve } from "@hono/node-server";
import {
  assistantText,
  imageUrlMessage,
  sessionMeta,
  subagentEvent,
  toolCall,
  toolCallOutput,
  userText,
} from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { elideHistoryRecord, encodeBodyRef } from "@prismshadow/penguin-core/interfaces";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  TraceEventsResponse,
  HistoryMessage,
  HistoryPage,
  HistoryProgress,
  HistoryRecords,
  MessagesResponse,
} from "../src/api/types.js";
import { machineHistory } from "../src/machines/history-routes.js";
import type { HistorySync } from "../src/machines/history-sync.js";
import { MachineSockets } from "../src/machines/machine-sockets.js";
import { machinesProxy } from "../src/machines/proxy.js";
import { TraceCache, dirNameOf } from "../src/machines/trace-cache.js";
import { FRAME_TEXT_BUDGET } from "../src/socket/line-frames.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { eventReader, windowRecords } from "./fixtures/history-stream.js";
import { appApi, fakeMachinesNode } from "./fixtures/machines.js";
import type { StreamEvent } from "./fixtures/history-stream.js";
import { sessionRow, uniqueSessionId } from "./fixtures/session.js";
import {
  createTestApp,
  loginAdmin,
  makeTempRoot,
  removeTempRoot,
  waitFor,
  writeTraceFile,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

const MACHINE = "QS7J4YVgSovi-Z2c";
const AGENT = "default_agent";
const PROJECT = "default_project";

/** A TCP link to the machine's port: every byte it carries back is counted, and it can be cut. */
async function linkTo(port: number) {
  const open = new Set<Socket>();
  const server = net.createServer((near) => {
    const far = net.connect(port, "127.0.0.1");
    open.add(near);
    open.add(far);
    near.pipe(far);
    far.pipe(near);
    const drop = () => {
      near.destroy();
      far.destroy();
      open.delete(near);
      open.delete(far);
    };
    near.on("error", drop);
    far.on("error", drop);
    near.on("close", drop);
    far.on("close", drop);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as { port: number }).port,
    /** Drops every connection it carries, as a lost link does; new ones get through. */
    cut: () => {
      for (const socket of open) socket.destroy();
      open.clear();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

let machine: TestApp;
let server: ReturnType<typeof serve>;
let link: Awaited<ReturnType<typeof linkTo>>;
let cookie = "";
let hubRoot = "";
const accepted = new Set<Socket>();

beforeAll(async () => {
  machine = await createTestApp();
  cookie = (await loginAdmin(machine.app)).cookie;
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: machine.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
      resolve(info.port),
    );
    server.on("connection", (socket: Socket) => accepted.add(socket));
  });
  attachTerminalWebSocket(server as unknown as HttpServer, {
    hmr: machine.deps.hmr,
    authService: machine.deps.authService,
    log: () => undefined,
  });
  link = await linkTo(port);
  hubRoot = await makeTempRoot();
});

afterAll(async () => {
  await link?.close();
  for (const socket of accepted) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await machine?.cleanup();
  await removeTempRoot(hubRoot);
});

/** What crossed the machine streams: each run of Trace bytes, as the hub handled it. */
let crossed: { k: string; off: number; bytes: number }[];
let hub: {
  sync: HistorySync;
  sockets: MachineSockets;
  get: (remote: string) => Promise<Response>;
  cacheFile: (sid: string, index?: number) => string;
};
let onFrame: (frame: { k: string; off: number; bytes: number }) => void;
/** Whether the hub has a forward to the machine; with none, only its copy can answer. */
let connected = true;

beforeEach(async () => {
  crossed = [];
  onFrame = () => undefined;
  connected = true;
  const sockets = new MachineSockets(() => undefined);
  const traces = path.join(hubRoot, `h-${Math.random().toString(36).slice(2)}`);
  const target = async () =>
    connected
      ? { agent: new http.Agent(), port: link.port, cookie, adoptedAt: null, session: 1 }
      : null;
  const { history, sync } = machineHistory({
    cache: new TraceCache(traces),
    sockets,
    target,
    log: () => undefined,
    tuning: {
      observe: (frame) => {
        crossed.push(frame);
        onFrame(frame);
      },
    },
  });
  const proxy = machinesProxy(target, undefined, () => undefined, { sockets, history });
  hub = {
    sync,
    sockets,
    get: async (remote) =>
      (await proxy(new Request(`http://localhost/server/${MACHINE}${remote}`)))!,
    cacheFile: (sid, index = 1) =>
      path.join(
        traces,
        dirNameOf(MACHINE),
        dirNameOf(sid),
        `${String(index).padStart(3, "0")}.jsonl`,
      ),
  };
});

afterEach(() => {
  hub.sync.close();
  hub.sockets.close();
});

const meta = (sid: string): AmspRecord =>
  sessionMeta({
    session_id: sid,
    provider: "custom",
    model_id: "m1",
    model_context_window: 1000,
    system_prompt: "",
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
    source: "user",
  });

/** `tasks` question-and-answer Tasks, each answer `pad` characters long. */
const tasks = (count: number, pad = 200): AmspRecord[] =>
  Array.from({ length: count }, (_, i) => [
    userText(`question ${i}`),
    assistantText(`${i} ${"a".repeat(pad)}`),
  ]).flat();

/** A Session on the machine, with its Trace file; returns the file's path. */
async function machineSession(
  sid: string,
  records: AmspRecord[],
  agentId = AGENT,
): Promise<string> {
  if (machine.deps.sessionsRepo.findById(sid) === null) {
    machine.deps.sessionsRepo.insert(sessionRow(sid, { agentId }));
  }
  return writeTraceFile(machine.root, PROJECT, agentId, "2026-10-29", sid, 1, records);
}

/** A history stream through the hub, read to its end. */
async function read(sid: string, query: string): Promise<StreamEvent[]> {
  const reader = eventReader(await hub.get(`/api/sessions/${sid}/history${query}`));
  await reader.finished;
  return reader.named();
}

const progress = (events: StreamEvent[]) =>
  events.filter((e) => e.event === "progress").map((e) => JSON.parse(e.data) as HistoryProgress);

/** The machine's own `/messages` for `query`, elided as the stream elides it. */
async function machineWindow(sid: string, query: string): Promise<unknown[]> {
  const res = await machine.app.request(`/api/sessions/${sid}/messages${query}`, {
    headers: { cookie },
  });
  const body = (await res.json()) as MessagesResponse;
  return JSON.parse(
    JSON.stringify(
      body.messages.map(
        (m) =>
          elideHistoryRecord(m, {
            agentId: AGENT,
            sessionId: sid,
            fileIndex: m.tracePosition!.fileIndex,
            ordinal: m.tracePosition!.ordinal,
          }).record,
      ),
    ),
  ) as unknown[];
}

describe("a machine Session's history through the hub's copy", () => {
  it("counts its progress to a fixed total, then sends the window, and keeps the file byte for byte", async () => {
    const sid = uniqueSessionId();
    const file = await machineSession(sid, [meta(sid), ...tasks(6)]);
    const events = await read(sid, "?tailLimit=20");

    const counted = progress(events).filter((p) => p.phase === "window");
    expect(counted.length).toBeGreaterThan(0);
    expect(new Set(counted.map((p) => p.totalBytes)).size).toBe(1);
    for (let i = 1; i < counted.length; i++) {
      expect(counted[i]!.doneBytes).toBeGreaterThanOrEqual(counted[i - 1]!.doneBytes);
    }
    expect(counted.at(-1)).toMatchObject({ machineId: MACHINE, waiting: null });
    expect(counted.at(-1)!.doneBytes).toBe(counted.at(-1)!.totalBytes);
    const order = events.map((e) => e.event).filter((e) => e !== "progress");
    expect(order[0]).toBe("page");
    expect(order.at(-1)).toBe("done");
    expect(windowRecords(events)).toEqual(await machineWindow(sid, "?tailLimit=20"));
    expect(await fs.readFile(hub.cacheFile(sid))).toEqual(await fs.readFile(file));
  });

  it("asks the machine for only the records appended since the last open", async () => {
    const sid = uniqueSessionId();
    const file = await machineSession(sid, [meta(sid), ...tasks(3)]);
    await read(sid, "?tailLimit=20");
    const size = (await fs.stat(file)).size;
    const appended = [userText("one more"), assistantText("sure"), assistantText("and done")]
      .map((m) => `${JSON.stringify(m)}\n`)
      .join("");
    await fs.appendFile(file, appended);
    crossed = [];

    const events = await read(sid, "?tailLimit=20");
    expect(crossed.map((c) => c.off)).toEqual([size]);
    expect(crossed.reduce((sum, c) => sum + c.bytes, 0)).toBe(Buffer.byteLength(appended));
    expect(windowRecords(events)).toEqual(await machineWindow(sid, "?tailLimit=20"));
    expect(await fs.readFile(hub.cacheFile(sid))).toEqual(await fs.readFile(file));
  });

  it("sends a Session held whole, reopened as the chat opens it after one more Task, only that Task's lines", async () => {
    const sid = uniqueSessionId();
    const file = await machineSession(sid, [meta(sid), ...tasks(40, 400)]);
    // As the chat opens it: a first window within a small budget, the rest of the 20 pairs
    // before it, and the fill behind both.
    const open = async () => {
      const first = await read(sid, "?tailLimit=20&budget=4096&fill=1");
      expect(first.at(-1)?.event).toBe("filled");
      const page = JSON.parse(first.find((e) => e.event === "page")!.data) as HistoryPage;
      const older = await read(sid, `?before=${encodeURIComponent(page.page!.before!)}&limit=18`);
      expect(older.at(-1)?.event).toBe("done");
      await waitFor(() => hub.sync.held().size === 0);
    };
    await open();
    expect(await fs.readFile(hub.cacheFile(sid))).toEqual(await fs.readFile(file));
    const size = (await fs.stat(file)).size;
    const task = [userText("one more"), assistantText("sure, here it is")]
      .map((m) => `${JSON.stringify(m)}\n`)
      .join("");
    await fs.appendFile(file, task);

    crossed = [];
    await open();
    expect(crossed.every((c) => c.off >= size)).toBe(true);
    expect(crossed.reduce((sum, c) => sum + c.bytes, 0)).toBe(Buffer.byteLength(task));
    expect(await fs.readFile(hub.cacheFile(sid))).toEqual(await fs.readFile(file));
  });

  it("resumes a transfer cut inside a line sent in parts from the bytes it holds", async () => {
    const sid = uniqueSessionId();
    const file = await machineSession(sid, [
      meta(sid),
      ...tasks(2),
      userText(`a long prompt ${"p".repeat(3 * FRAME_TEXT_BUDGET)}`),
      assistantText("read it"),
    ]);
    let cut = false;
    onFrame = (frame) => {
      // Cut once, right after the first piece of the long line arrived.
      if (!cut && frame.bytes === FRAME_TEXT_BUDGET) {
        cut = true;
        link.cut();
      }
    };
    const events = await read(sid, "?tailLimit=20");

    expect(cut).toBe(true);
    expect(events.at(-1)?.event).toBe("done");
    const bytes = await fs.readFile(file);
    expect(await fs.readFile(hub.cacheFile(sid))).toEqual(bytes);
    const sent = crossed.reduce((sum, c) => sum + c.bytes, 0);
    expect(sent).toBeLessThanOrEqual(bytes.length + FRAME_TEXT_BUDGET);
  });

  it("starts the copy over when the machine's file was rewritten or replaced, and drops a deleted subagent's", async () => {
    const sid = uniqueSessionId();
    const child = uniqueSessionId();
    await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", child, 1, [
      meta(child),
      assistantText("the child's answer"),
    ]);
    const file = await machineSession(sid, [
      meta(sid),
      userText("delegate"),
      subagentEvent(child),
      assistantText("ABCDEF"),
    ]);
    await read(sid, "?tailLimit=20");
    const childCopy = hub.cacheFile(child);
    expect((await fs.stat(childCopy)).size).toBeGreaterThan(0);

    // Same size, other bytes, at the end where the anchor looks.
    const rewritten = (await fs.readFile(file, "utf8")).replace("ABCDEF", "UVWXYZ");
    await fs.writeFile(file, rewritten);
    await fs.rm(
      path.join(
        machine.root,
        PROJECT,
        "agents",
        AGENT,
        "traces",
        "2026-10-29",
        `${child}_001.jsonl`,
      ),
    );
    const events = await read(sid, "?tailLimit=20");
    expect(await fs.readFile(hub.cacheFile(sid), "utf8")).toBe(rewritten);
    expect(windowRecords(events).some((r) => JSON.stringify(r).includes("UVWXYZ"))).toBe(true);
    await expect(fs.stat(childCopy)).rejects.toThrow();

    // A new file under the same name: another inode, so nothing held is offered again.
    await fs.rm(file);
    const replaced = await machineSession(sid, [meta(sid), ...tasks(2)]);
    await read(sid, "?tailLimit=20");
    expect(await fs.readFile(hub.cacheFile(sid))).toEqual(await fs.readFile(replaced));
  });

  it("goes on after the window with the fill's progress and ends with filled, the whole Session held", async () => {
    const sid = uniqueSessionId();
    const file = await machineSession(sid, [meta(sid), ...tasks(25)]);
    const events = await read(sid, "?tailLimit=20&fill=1");

    const names = events.map((e) => e.event);
    const done = names.indexOf("done");
    expect(done).toBeGreaterThan(0);
    expect(names.at(-1)).toBe("filled");
    expect(progress(events.slice(done)).some((p) => p.phase === "fill")).toBe(true);
    expect(await fs.readFile(hub.cacheFile(sid))).toEqual(await fs.readFile(file));
  });

  it("answers a rotated file's events and an image by reference from the copy, and leaves the live file's to the machine", async () => {
    const sid = uniqueSessionId();
    const png = `data:image/png;base64,${Buffer.from("not really a png").toString("base64")}`;
    await machineSession(sid, [meta(sid), userText("look"), imageUrlMessage(png), ...tasks(2)]);
    const live = await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", sid, 2, [
      meta(sid),
      ...tasks(2),
    ]);
    const window = windowRecords(await read(sid, "?tailLimit=20&fill=1")) as HistoryMessage[];
    const image = window.find((r) => (r.payload as { type?: string }).type === "image_url");
    const url = (image!.payload as { image_url: string }).image_url;
    expect(url).toMatch(/\/trace-image\?file=1&ordinal=2$/);
    const machineEvents = async (index: number) =>
      (await (
        await machine.app.request(`/api/sessions/${sid}/traces/${index}?offset=1&limit=3`, {
          headers: { cookie },
        })
      ).json()) as TraceEventsResponse;

    // The live file grows on the machine: its events are the machine's to count.
    await fs.appendFile(live, `${JSON.stringify(userText("one more"))}\n`);
    const viaHub = (await (
      await hub.get(`/api/sessions/${sid}/traces/2?offset=1&limit=3`)
    ).json()) as TraceEventsResponse;
    expect(viaHub).toEqual(await machineEvents(2));
    const rotated = await machineEvents(1);

    connected = false;
    const fromCopy = await hub.get(`/api/sessions/${sid}/traces/1?offset=1&limit=3`);
    expect(fromCopy.status).toBe(200);
    expect(await fromCopy.json()).toEqual(rotated);
    const picture = await hub.get(url);
    expect(picture.status).toBe(200);
    expect(picture.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await picture.arrayBuffer()).toString()).toBe("not really a png");
    // What the copy does not answer is forwarded as before, and with no forward that says so.
    expect((await hub.get(`/api/sessions/${sid}/traces/2?offset=1&limit=3`)).status).toBe(503);
    expect((await hub.get(`/api/sessions/${sid}/traces/1/analysis`)).status).toBe(503);
  });

  it("does not send again a line held below the newest run", async () => {
    const sid = uniqueSessionId();
    const file = await machineSession(sid, [
      meta(sid),
      ...tasks(5),
      userText("read it"),
      toolCall({ name: "read_file", arguments: '{"file_path":"/w/a.txt"}', toolCallId: "c1" }),
      toolCallOutput({ output: "x".repeat(200_000), toolCallId: "c1", status: "completed" }),
      assistantText("read"),
      ...tasks(5),
    ]);
    const window = windowRecords(await read(sid, "?tailLimit=2")) as HistoryMessage[];
    expect(window.some((r) => (r.payload as { type?: string }).type === "tool_call_output")).toBe(
      false,
    );
    const ref = encodeBodyRef(
      { agentId: AGENT, sessionId: sid, fileIndex: 1, ordinal: 13 },
      "payload.output",
    );
    const body = eventReader(
      await hub.get(`/api/sessions/${sid}/trace-body?ref=${encodeURIComponent(ref)}`),
    );
    await body.finished;
    expect(body.has("done")).toBe(true);
    await waitFor(() => hub.sync.held().size === 0);

    crossed = [];
    expect((await read(sid, "?fill=only")).at(-1)?.event).toBe("filled");
    const size = (await fs.stat(file)).size;
    expect(await fs.readFile(hub.cacheFile(sid))).toEqual(await fs.readFile(file));
    // The fill brought what was missing around the held output line, never the line again.
    expect(crossed.reduce((sum, c) => sum + c.bytes, 0)).toBeLessThan(size - 200_000);
  });

  it("resumes a fill cut inside a file's first line held, before anything of the file was whole", async () => {
    const sid = uniqueSessionId();
    machine.deps.sessionsRepo.insert(sessionRow(sid));
    const first = await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", sid, 1, [
      meta(sid),
      ...tasks(2),
      userText("read it"),
      toolCall({ name: "read_file", arguments: '{"file_path":"/w/b.txt"}', toolCallId: "c9" }),
      toolCallOutput({
        output: "y".repeat(12 * FRAME_TEXT_BUDGET),
        toolCallId: "c9",
        status: "completed",
      }),
    ]);
    await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", sid, 2, [
      meta(sid),
      ...tasks(2),
    ]);
    const k1 = `${AGENT}/${sid}/1`;
    await read(sid, "?tailLimit=1");
    await waitFor(() => hub.sync.held().size === 0);
    let parts = 0;
    let cut = false;
    onFrame = (frame) => {
      if (frame.k !== k1 || cut) return;
      parts += 1;
      if (parts === 4) {
        cut = true;
        link.cut();
      }
    };
    crossed = [];
    expect((await read(sid, "?fill=only")).at(-1)?.event).toBe("filled");

    expect(cut).toBe(true);
    expect(await fs.readFile(hub.cacheFile(sid, 1))).toEqual(await fs.readFile(first));
    const size = (await fs.stat(first)).size;
    const sent = crossed.filter((c) => c.k === k1).reduce((sum, c) => sum + c.bytes, 0);
    expect(sent).toBeLessThanOrEqual(size + FRAME_TEXT_BUDGET);
  });

  it("sends a reader that left and came back only what its first open had not brought", async () => {
    const sid = uniqueSessionId();
    const file = await machineSession(sid, [meta(sid), ...tasks(150, 1_000)]);
    let leave: () => Promise<void> = async () => undefined;
    let left: Promise<void> | null = null;
    // The reader leaves the moment the fourth run of lines has crossed.
    onFrame = () => {
      if (crossed.length === 4) left = leave();
    };
    const leaving = eventReader(await hub.get(`/api/sessions/${sid}/history?tailLimit=20&fill=1`));
    leave = leaving.stop;
    await waitFor(() => left !== null);
    await left;
    onFrame = () => undefined;
    await waitFor(() => hub.sync.held().size === 0);
    const before = crossed.reduce((sum, c) => sum + c.bytes, 0);
    expect(before).toBeLessThan((await fs.stat(file)).size);

    expect((await read(sid, "?tailLimit=20&fill=1")).at(-1)?.event).toBe("filled");
    const size = (await fs.stat(file)).size;
    expect(await fs.readFile(hub.cacheFile(sid))).toEqual(await fs.readFile(file));
    expect(crossed.reduce((sum, c) => sum + c.bytes, 0)).toBeLessThanOrEqual(
      size + FRAME_TEXT_BUDGET,
    );
  });

  it("sends an elided value whole, fetching its line once and then from the copy", async () => {
    const sid = uniqueSessionId();
    const output = "row\n".repeat(10_000);
    await machineSession(sid, [
      meta(sid),
      userText("read it"),
      toolCall({ name: "read_file", arguments: '{"file_path":"/w/a.txt"}', toolCallId: "c1" }),
      toolCallOutput({ output, toolCallId: "c1", status: "completed" }),
      assistantText("done"),
      ...tasks(2),
    ]);
    // The newest Task alone: the output's line lies in an older one, never brought.
    await read(sid, "?tailLimit=1");
    await waitFor(() => hub.sync.held().size === 0);
    const ref = encodeBodyRef(
      { agentId: AGENT, sessionId: sid, fileIndex: 1, ordinal: 3 },
      "payload.output",
    );

    const body = async () => {
      const reader = eventReader(
        await hub.get(`/api/sessions/${sid}/trace-body?ref=${encodeURIComponent(ref)}`),
      );
      await reader.finished;
      const events = reader.named();
      return {
        value: events
          .filter((e) => e.event === "part")
          .map((e) => (JSON.parse(e.data) as HistoryRecords).text)
          .join(""),
        progress: progress(events),
      };
    };
    crossed = [];
    const fetched = await body();
    expect(fetched.value).toBe(output);
    expect(crossed.length).toBeGreaterThan(0);
    // One total for the whole stream, counted up once, never back to 0.
    expect(new Set(fetched.progress.map((p) => p.totalBytes)).size).toBe(1);
    const done = fetched.progress.map((p) => p.doneBytes);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(done.at(-1)).toBe(fetched.progress[0]!.totalBytes);

    crossed = [];
    expect((await body()).value).toBe(output);
    expect(crossed).toEqual([]);
  });
});

describe("a machine Session's history opened by its URL alone", () => {
  let hubApp: TestApp;
  let hubCookie = "";
  /** Whether the hub has lost its forward to the machine. */
  let away = false;

  beforeAll(async () => {
    hubApp = await createTestApp({
      machines: fakeMachinesNode(
        () => [{ machineId: MACHINE, alias: "gpu-box", api: appApi(machine.app, cookie) }],
        (machineId) =>
          machineId === MACHINE && !away
            ? { agent: new http.Agent(), port: link.port, cookie, adoptedAt: null, session: 1 }
            : null,
      ),
    });
    hubCookie = (await loginAdmin(hubApp.app)).cookie;
  });

  afterAll(async () => {
    await hubApp?.cleanup();
  });

  it("is answered by the hub's stream through the Session forward, and kept under the hub's data root", async () => {
    const sid = uniqueSessionId();
    const file = await machineSession(sid, [meta(sid), ...tasks(3)]);
    const reader = eventReader(
      await hubApp.app.request(`/api/sessions/${sid}/history?tailLimit=20`, {
        headers: { cookie: hubCookie },
      }),
    );
    await reader.finished;

    expect(reader.named().at(-1)?.event).toBe("done");
    expect(windowRecords(reader.events)).toEqual(await machineWindow(sid, "?tailLimit=20"));
    const copy = path.join(
      hubApp.root,
      "machines",
      "traces",
      dirNameOf(MACHINE),
      dirNameOf(sid),
      "001.jsonl",
    );
    expect(await fs.readFile(copy)).toEqual(await fs.readFile(file));
  });
  it("answers the Trace panel's Project-scoped events from the copy for the Session's Project, and finds nothing under another", async () => {
    const sid = uniqueSessionId();
    await machineSession(sid, [meta(sid), ...tasks(2)]);
    await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", sid, 2, [
      meta(sid),
      ...tasks(1),
    ]);
    const opened = eventReader(
      await hubApp.app.request(`/api/sessions/${sid}/history?tailLimit=20&fill=1`, {
        headers: { cookie: hubCookie },
      }),
    );
    await opened.finished;
    expect(opened.named().at(-1)?.event).toBe("filled");

    away = true;
    try {
      const events = (project: string) =>
        hubApp.app.request(
          `/server/${MACHINE}/api/projects/${project}/agents/${AGENT}/traces/${sid}/1?offset=0&limit=5`,
          { headers: { cookie: hubCookie } },
        );
      const own = await events(PROJECT);
      expect(own.status).toBe(200);
      expect(((await own.json()) as TraceEventsResponse).total).toBe(5);
      const wrong = await events("another_project");
      expect(wrong.status).toBe(404);
      expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe(
        "trace_not_found",
      );
    } finally {
      away = false;
    }
  });

  // Last: it resets the admin's password, which signs the suite's admin out.
  it("ends an HTTP history stream the moment its user is signed out everywhere", async () => {
    const sid = uniqueSessionId();
    await machineSession(sid, [meta(sid), ...tasks(1)]);
    away = true;
    try {
      const waiting = eventReader(
        await hubApp.app.request(`/api/sessions/${sid}/history?tailLimit=20`, {
          headers: { cookie: hubCookie },
        }),
      );
      await waitFor(() => waiting.has("progress"));
      expect(waiting.ended).toBe(false);
      await hubApp.deps.adminService.resetPassword("admin", "a new password, long enough");
      // At once — well before the stream's next beat would notice the sign-in gone.
      const ended = await Promise.race([
        waiting.finished.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
      expect(ended).toBe(true);
      expect(waiting.has("done")).toBe(false);
    } finally {
      away = false;
    }
  });
});
