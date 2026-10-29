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
import { randomBytes } from "node:crypto";
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
import type { MachineHistory } from "../src/machines/history-routes.js";
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
  /** Bytes carried, from the machine (`down`) and to it (`up`), on every connection. */
  const carried = { down: 0, up: 0 };
  const server = net.createServer((near) => {
    const far = net.connect(port, "127.0.0.1");
    open.add(near);
    open.add(far);
    near.pipe(far);
    far.pipe(near);
    far.on("data", (bytes: Buffer) => (carried.down += bytes.length));
    near.on("data", (bytes: Buffer) => (carried.up += bytes.length));
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
    /** What it has carried so far, each way. */
    carried: () => ({ ...carried }),
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
  history: MachineHistory;
  get: (remote: string) => Promise<Response>;
  cacheFile: (sid: string, index?: number) => string;
};
let onFrame: (frame: { k: string; off: number; bytes: number }) => void;
/** Whether the hub has a forward to the machine; with none, only its copy can answer. */
let connected = true;
/** The Projects the hub has config for (an analysis is priced here only for those). */
let hubProjects = new Set<string>();

beforeEach(async () => {
  crossed = [];
  onFrame = () => undefined;
  connected = true;
  hubProjects = new Set([PROJECT]);
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
    analyze: (projectId, records) => machine.deps.traceService.analyzeRecords(projectId, records),
    hasProject: (projectId) => hubProjects.has(projectId),
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
    history,
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

/** Resolves once `file` of the copy is gone (a drop runs behind the stream that caused it). */
async function dropped(file: string): Promise<void> {
  const start = Date.now();
  while ((await fs.stat(file).catch(() => null)) !== null) {
    if (Date.now() - start > 2000) throw new Error(`${file} was never dropped`);
    await new Promise((r) => setTimeout(r, 5));
  }
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

  /**
   * Opens `sid` as the chat opens it: a first window within a small budget, the rest of the 20
   * pairs before it, and the fill behind both.
   */
  const openAsTheChat = async (sid: string) => {
    const first = await read(sid, "?tailLimit=20&budget=4096&fill=1");
    expect(first.at(-1)?.event).toBe("filled");
    const page = JSON.parse(first.find((e) => e.event === "page")!.data) as HistoryPage;
    const older = await read(sid, `?before=${encodeURIComponent(page.page!.before!)}&limit=18`);
    expect(older.at(-1)?.event).toBe("done");
    await waitFor(() => hub.sync.held().size === 0);
  };

  it("reopens a Session it holds whole and unchanged for a few hundred bytes each way, none of them Trace", async () => {
    const sid = uniqueSessionId();
    // Answers that do not compress, so a window sent again would show on the link.
    const noisy = Array.from({ length: 40 }, (_, i) => [
      userText(`question ${i}`),
      assistantText(randomBytes(300).toString("base64")),
    ]).flat();
    const file = await machineSession(sid, [meta(sid), ...noisy]);
    await openAsTheChat(sid);
    expect(await fs.readFile(hub.cacheFile(sid))).toEqual(await fs.readFile(file));

    crossed = [];
    const before = link.carried();
    await openAsTheChat(sid);
    const after = link.carried();

    // Two streams (the first window, then the rest of the 20 pairs), each the machine's window
    // facts and no line: about 2.3 KB from the machine and 1.1 KB of `have` to it, for 26 KB.
    expect(crossed).toEqual([]);
    expect(after.down - before.down).toBeLessThan(3 * 1024);
    expect(after.up - before.up).toBeLessThan(2 * 1024);
  });

  it("sends a Session held whole, reopened as the chat opens it after one more Task, only that Task's lines", async () => {
    const sid = uniqueSessionId();
    const file = await machineSession(sid, [meta(sid), ...tasks(40, 400)]);
    const open = () => openAsTheChat(sid);
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

  it("answers the Trace panel's events and analysis of a file synced to the copy, live or rotated, and an image by reference, the machine away", async () => {
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
    const machineSays = async (remote: string) =>
      (await (await machine.app.request(remote, { headers: { cookie } })).json()) as unknown;

    // The live file grew on the machine; the panel makes it whole before it reads it.
    await fs.appendFile(live, `${JSON.stringify(userText("one more"))}\n`);
    expect((await read(sid, "?fill=only&file=2")).at(-1)?.event).toBe("filled");
    const own = {
      live: await machineSays(`/api/sessions/${sid}/traces/2?offset=1&limit=3`),
      tail: await machineSays(`/api/sessions/${sid}/traces/2?offset=4&limit=200`),
      rotated: await machineSays(`/api/sessions/${sid}/traces/1?offset=1&limit=3`),
      analysis: await machineSays(`/api/sessions/${sid}/traces/2/analysis`),
    };

    connected = false;
    const json = async (res: Response) => {
      expect(res.status).toBe(200);
      return (await res.json()) as unknown;
    };
    expect(await json(await hub.get(`/api/sessions/${sid}/traces/2?offset=1&limit=3`))).toEqual(
      own.live,
    );
    expect(await json(await hub.get(`/api/sessions/${sid}/traces/2?offset=4&limit=200`))).toEqual(
      own.tail,
    );
    expect(await json(await hub.get(`/api/sessions/${sid}/traces/1?offset=1&limit=3`))).toEqual(
      own.rotated,
    );
    const picture = await hub.get(url);
    expect(picture.status).toBe(200);
    expect(picture.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await picture.arrayBuffer()).toString()).toBe("not really a png");
    // On the machine's own path no Project comes along: with the machine away the analysis is
    // the machine's (and there is no forward); once it is back the Project is asked of it once,
    // and the analysis is the hub's from then on, the machine away again.
    const analysis = `/api/sessions/${sid}/traces/2/analysis`;
    expect((await hub.get(analysis)).status).toBe(503);
    connected = true;
    expect(await json(await hub.get(analysis))).toEqual(own.analysis);
    connected = false;
    expect(await json(await hub.get(analysis))).toEqual(own.analysis);
  });

  it("keeps the rest of the Session's copy when one folded value is fetched from the machine", async () => {
    const sid = uniqueSessionId();
    machine.deps.sessionsRepo.insert(sessionRow(sid));
    const rotated = await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", sid, 1, [
      meta(sid),
      ...tasks(4),
    ]);
    await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", sid, 2, [
      meta(sid),
      userText("read it"),
      toolCall({ name: "read_file", arguments: '{"file_path":"/w/a.txt"}', toolCallId: "c1" }),
      toolCallOutput({ output: "row\n".repeat(10_000), toolCallId: "c1", status: "completed" }),
      assistantText("done"),
      ...tasks(2),
    ]);
    await read(sid, "?tailLimit=1");
    await waitFor(() => hub.sync.held().size === 0);
    expect((await read(sid, "?fill=only&file=1")).at(-1)?.event).toBe("filled");
    await waitFor(() => hub.sync.held().size === 0);

    const ref = encodeBodyRef(
      { agentId: AGENT, sessionId: sid, fileIndex: 2, ordinal: 3 },
      "payload.output",
    );
    crossed = [];
    const body = eventReader(
      await hub.get(`/api/sessions/${sid}/trace-body?ref=${encodeURIComponent(ref)}`),
    );
    await body.finished;
    expect(body.has("done")).toBe(true);
    expect(crossed.length).toBeGreaterThan(0);
    await waitFor(() => hub.sync.held().size === 0);

    expect(await fs.readFile(hub.cacheFile(sid, 1))).toEqual(await fs.readFile(rotated));
    crossed = [];
    expect((await read(sid, "?fill=only&file=1")).at(-1)?.event).toBe("filled");
    expect(crossed.filter((c) => c.k === `${AGENT}/${sid}/1`)).toEqual([]);
  });

  it("unfolds a subagent's value after one of the Session's own was fetched", async () => {
    const sid = uniqueSessionId();
    const child = uniqueSessionId();
    await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", child, 1, [
      meta(child),
      toolCall({ name: "read_file", arguments: '{"file_path":"/w/c.txt"}', toolCallId: "k1" }),
      toolCallOutput({ output: "c".repeat(60_000), toolCallId: "k1", status: "completed" }),
      assistantText("the child's answer"),
    ]);
    await machineSession(sid, [
      meta(sid),
      userText("read it"),
      toolCall({ name: "read_file", arguments: '{"file_path":"/w/a.txt"}', toolCallId: "c1" }),
      toolCallOutput({ output: "r".repeat(60_000), toolCallId: "c1", status: "completed" }),
      assistantText("done"),
      userText("delegate"),
      subagentEvent(child),
      assistantText("delegated"),
      ...tasks(1),
    ]);
    await read(sid, "?tailLimit=1");
    await waitFor(() => hub.sync.held().size === 0);
    const unfold = async (ref: string) => {
      const reader = eventReader(
        await hub.get(`/api/sessions/${sid}/trace-body?ref=${encodeURIComponent(ref)}`),
      );
      await reader.finished;
      await waitFor(() => hub.sync.held().size === 0);
      return reader.named().at(-1)?.event;
    };
    const childRef = encodeBodyRef(
      { agentId: AGENT, sessionId: child, fileIndex: 1, ordinal: 2 },
      "payload.output",
    );
    const ownRef = encodeBodyRef(
      { agentId: AGENT, sessionId: sid, fileIndex: 1, ordinal: 3 },
      "payload.output",
    );

    expect(await unfold(childRef)).toBe("done");
    expect(await unfold(ownRef)).toBe("done");
    expect(await unfold(childRef)).toBe("done");
  });

  it("lets go of a Session the machine deleted: its copy goes, and nothing of it is answered from here", async () => {
    const sid = uniqueSessionId();
    const png = `data:image/png;base64,${Buffer.from("secret picture").toString("base64")}`;
    await machineSession(sid, [meta(sid), userText("look"), imageUrlMessage(png), ...tasks(2)]);
    await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", sid, 2, [
      meta(sid),
      ...tasks(2),
    ]);
    expect((await read(sid, "?tailLimit=20&fill=1")).at(-1)?.event).toBe("filled");
    await waitFor(() => hub.sync.held().size === 0);
    const deleted = await machine.app.request(`/api/sessions/${sid}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleted.status).toBe(204);

    const again = await read(sid, "?tailLimit=20");
    expect(again.at(-1)).toMatchObject({ event: "error" });
    expect(JSON.parse(again.at(-1)!.data)).toMatchObject({ code: "session_not_found" });
    await dropped(hub.cacheFile(sid, 1));
    expect((await hub.get(`/api/sessions/${sid}/traces/1?offset=0&limit=5`)).status).toBe(404);
    expect((await hub.get(`/api/sessions/${sid}/trace-image?file=1&ordinal=2`)).status).toBe(404);
  });

  it("drops a Session's copy when the machine says it deleted it", async () => {
    const sid = uniqueSessionId();
    const png = `data:image/png;base64,${Buffer.from("secret picture").toString("base64")}`;
    await machineSession(sid, [meta(sid), userText("look"), imageUrlMessage(png), ...tasks(2)]);
    expect((await read(sid, "?tailLimit=20&fill=1")).at(-1)?.event).toBe("filled");
    await waitFor(() => hub.sync.held().size === 0);
    connected = false;
    const image = `/api/sessions/${sid}/trace-image?file=1&ordinal=2`;
    expect((await hub.get(image)).status).toBe(200);

    hub.history.hear(MACHINE, JSON.stringify({ type: "session_deleted", sessionId: sid }));

    await dropped(hub.cacheFile(sid, 1));
    // Not from the copy any more: the forward, which has no machine to reach.
    expect((await hub.get(image)).status).toBe(503);
  });

  it("finds a Session deleted on the machine though nothing told this server, drops its copy, and answers nothing more from it", async () => {
    const sid = uniqueSessionId();
    const png = `data:image/png;base64,${Buffer.from("secret picture").toString("base64")}`;
    await machineSession(sid, [meta(sid), userText("look"), imageUrlMessage(png), ...tasks(2)]);
    await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", sid, 2, [
      meta(sid),
      ...tasks(2),
    ]);
    expect((await read(sid, "?tailLimit=20&fill=1")).at(-1)?.event).toBe("filled");
    await waitFor(() => hub.sync.held().size === 0);
    // Deleted on the machine's own side: no event reaches this server, and no history is read.
    const deleted = await machine.app.request(`/api/sessions/${sid}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleted.status).toBe(204);

    // The read the copy answers does not wait on the machine; asking it behind the answer is
    // what finds the deletion, and the copy goes.
    const image = `/api/sessions/${sid}/trace-image?file=1&ordinal=2`;
    expect((await hub.get(image)).status).toBe(200);
    await dropped(hub.cacheFile(sid, 1));
    const after = await hub.get(image);
    expect(after.status).toBe(404);
    expect(((await after.json()) as { error: { code: string } }).error.code).toBe(
      "session_not_found",
    );
    expect((await hub.get(`/api/sessions/${sid}/traces/1?offset=0&limit=5`)).status).toBe(404);
  });

  it("leaves the analysis of a Session whose Project this server has no config for to the machine", async () => {
    const sid = uniqueSessionId();
    await machineSession(sid, [meta(sid), ...tasks(3)]);
    expect((await read(sid, "?tailLimit=20&fill=1")).at(-1)?.event).toBe("filled");
    await waitFor(() => hub.sync.held().size === 0);
    const analysis = `/api/sessions/${sid}/traces/1/analysis`;
    // Learnt and computed here while the Project is this server's ...
    expect((await hub.get(analysis)).status).toBe(200);
    connected = false;
    expect((await hub.get(analysis)).status).toBe(200);
    // ... and the machine's to price once it is not (forwarded: with the machine away, no answer).
    hubProjects.clear();
    expect((await hub.get(analysis)).status).toBe(503);
  });

  it("loads a Trace with a line of NULs in it, as the machine reads it", async () => {
    const sid = uniqueSessionId();
    const file = await machineSession(sid, [meta(sid), ...tasks(2)]);
    // A crash can leave such a line; the machine's reader skips it as no record.
    await fs.appendFile(file, Buffer.from([0, 0, 0, 0, 0x0a]));
    await fs.appendFile(
      file,
      tasks(2)
        .map((m) => `${JSON.stringify(m)}\n`)
        .join(""),
    );

    const events = await read(sid, "?tailLimit=20");
    expect(events.at(-1)?.event).toBe("done");
    expect(windowRecords(events)).toEqual(await machineWindow(sid, "?tailLimit=20"));
  });

  it("reads a window again from the machine when its copy does not read back, keeping the rest of the copy", async () => {
    const sid = uniqueSessionId();
    machine.deps.sessionsRepo.insert(sessionRow(sid));
    const rotated = await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", sid, 1, [
      meta(sid),
      ...tasks(3),
    ]);
    const live = await writeTraceFile(machine.root, PROJECT, AGENT, "2026-10-29", sid, 2, [
      meta(sid),
      ...tasks(40, 300),
    ]);
    expect((await read(sid, "?tailLimit=30&fill=1")).at(-1)?.event).toBe("filled");
    await waitFor(() => hub.sync.held().size === 0);
    // A record in the middle of the window damaged in the copy, past what the machine's checks
    // of the held run's edges read: the copy no longer reads back as the machine laid it out.
    const liveBytes = await fs.readFile(live);
    const lineStart = liveBytes.lastIndexOf(0x0a, liveBytes.indexOf("question 20")) + 1;
    expect(lineStart).toBeGreaterThan(4096);
    expect(liveBytes.length - lineStart).toBeGreaterThan(4096);
    const copy = await fs.open(hub.cacheFile(sid, 2), "r+");
    await copy.write(Buffer.from("#"), 0, 1, lineStart);
    await copy.close();

    crossed = [];
    const events = await read(sid, "?tailLimit=30");
    expect(events.at(-1)?.event).toBe("done");
    expect(windowRecords(events)).toEqual(await machineWindow(sid, "?tailLimit=30"));
    // Only the window's own bytes came again, and the copy is whole once more.
    expect(crossed.length).toBeGreaterThan(0);
    expect(crossed.every((c) => c.k === `${AGENT}/${sid}/2` && c.off > 0)).toBe(true);
    expect(await fs.readFile(hub.cacheFile(sid, 1))).toEqual(await fs.readFile(rotated));
    expect(await fs.readFile(hub.cacheFile(sid, 2))).toEqual(liveBytes);
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
