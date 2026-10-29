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
 *   the machine sends exactly those three lines.
 * - Given the link cut mid-transfer, inside a line sent in parts, then the job reopens from what
 *   it holds: the copy equals the machine's file byte for byte, and the bytes that crossed over
 *   both streams exceed the file by at most one frame.
 * - Given the machine's file rewritten in place (same size, other bytes), or replaced by a new
 *   one, when the conversation is opened again, then the copy starts over and equals the file
 *   as it is now; a subagent's file deleted on the machine leaves no copy behind.
 * - Given `fill=1` over a Session longer than its window, then after `done` the fill's
 *   progress follows and `filled` ends the stream, with the whole Session held.
 * - Given a file the copy holds whole, then the Trace panel's events and an image by reference
 *   are answered from it, even with the machine away; what it cannot answer is forwarded.
 * - Given a value the window elided, then `trace-body` sends it whole: the first time after
 *   fetching its one line, the next time from the copy alone.
 * - Given the conversation opened by its URL alone (no machine prefix, as a reload asks), then
 *   the hub's Session forward answers it with the same stream, its copy under the hub's root.
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
import { elideHistoryRecord } from "@prismshadow/penguin-core/interfaces";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  HistoryMessage,
  HistoryProgress,
  HistoryRecords,
  MessagesResponse,
} from "../src/api/types.js";
import { machineHistory } from "../src/machines/history-routes.js";
import type { HistorySync } from "../src/machines/history-sync.js";
import { MachineSockets } from "../src/machines/machine-sockets.js";
import { machinesProxy } from "../src/machines/proxy.js";
import { TraceCache } from "../src/machines/trace-cache.js";
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
      path.join(traces, MACHINE, sid, `${String(index).padStart(3, "0")}.jsonl`),
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

  it("answers the Trace panel's events and an image by reference from a whole copy, with the machine away", async () => {
    const sid = uniqueSessionId();
    const png = `data:image/png;base64,${Buffer.from("not really a png").toString("base64")}`;
    await machineSession(sid, [meta(sid), userText("look"), imageUrlMessage(png), ...tasks(2)]);
    const window = windowRecords(await read(sid, "?tailLimit=20&fill=1")) as HistoryMessage[];
    const image = window.find((r) => (r.payload as { type?: string }).type === "image_url");
    const url = (image!.payload as { image_url: string }).image_url;
    expect(url).toMatch(/\/trace-image\?file=1&ordinal=2$/);
    const events = await (
      await machine.app.request(`/api/sessions/${sid}/traces/1?offset=1&limit=3`, {
        headers: { cookie },
      })
    ).json();

    connected = false;
    const fromCopy = await hub.get(`/api/sessions/${sid}/traces/1?offset=1&limit=3`);
    expect(fromCopy.status).toBe(200);
    expect(await fromCopy.json()).toEqual(events);
    const picture = await hub.get(url);
    expect(picture.status).toBe(200);
    expect(picture.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await picture.arrayBuffer()).toString()).toBe("not really a png");
    // What the copy does not hold is forwarded as before, and with no forward that says so.
    expect((await hub.get(`/api/sessions/${sid}/traces/1/analysis`)).status).toBe(503);
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
    ]);
    const window = windowRecords(await read(sid, "?tailLimit=20")) as HistoryMessage[];
    const ref = window.flatMap((r) => r.elided ?? []).find((e) => e.path === "payload.output")?.ref;
    expect(ref).toEqual(expect.any(String));

    const body = async () => {
      const reader = eventReader(
        await hub.get(`/api/sessions/${sid}/trace-body?ref=${encodeURIComponent(ref!)}`),
      );
      await reader.finished;
      return reader
        .named()
        .filter((e) => e.event === "part")
        .map((e) => (JSON.parse(e.data) as HistoryRecords).text)
        .join("");
    };
    expect(await body()).toBe(output);
    crossed = [];
    expect(await body()).toBe(output);
    expect(crossed).toEqual([]);
  });
});

describe("a machine Session's history opened by its URL alone", () => {
  let hubApp: TestApp;
  let hubCookie = "";

  beforeAll(async () => {
    hubApp = await createTestApp({
      machines: fakeMachinesNode(
        () => [{ machineId: MACHINE, alias: "gpu-box", api: appApi(machine.app, cookie) }],
        (machineId) =>
          machineId === MACHINE
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
    const copy = path.join(hubApp.root, "machines", "traces", MACHINE, sid, "001.jsonl");
    expect(await fs.readFile(copy)).toEqual(await fs.readFile(file));
  });
});
