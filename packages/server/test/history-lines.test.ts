/**
 * The machine leg of a history stream, `GET /api/sessions/:id/history-lines`
 * (services/history-lines.ts), read the way a hub reads it: the frames committed whole
 * (socket/line-frames.ts LineCommitter), the window rebuilt from them (history-layout.ts).
 *
 * Fixture: a Session over two shards (the first rotated, final), whose newest Tasks span
 * both, one of them carrying a tool output several frames long.
 *
 * - Given nothing held, the window's light lines come newest segment first, `ready` precedes
 *   every heavy and fill line, the heavy line rides the window as a stub, the window assembles
 *   before the heavy line arrives, and with `fill=1` every file arrives byte for byte, the
 *   totals announcing exactly what was sent.
 * - Given a valid `have`, only the bytes past its `hi` are sent, and nothing of a final file
 *   the hub holds whole.
 * - Given a held partial line, the line is continued from the partial's end, not resent.
 * - Given a wrong anchor, a file recreated under a new inode, or a file that shrank, that file
 *   is `reset` and sent from scratch.
 * - Given a file that vanished, it is absent from the window's files.
 * - Given `body=<ref>`, exactly that line is sent; a ref into no line of the Session is a 404.
 * - Given `budget=`, the window holds the newest whole Tasks whose folded records fit (at least
 *   one, more than the bodies whole would allow) and carries `before`; the `before` windows
 *   continue exactly where each stopped, down to the full transcript.
 */
import fs from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assistantText,
  requestBegin,
  requestEnd,
  sessionMeta,
  toolCall,
  toolCallOutput,
  userText,
} from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import type {
  HistoryHave,
  HistoryLinesFrame,
  HistoryLinesWindow,
  HistoryMessage,
  HistoryPartFrame,
} from "../src/api/types.js";
import { assembleWindow } from "../src/services/history-layout.js";
import {
  anchorOf,
  encodeHistoryHave,
  hiAnchorRange,
  historyFileKey,
  loAnchorRange,
} from "../src/services/history-wire.js";
import { LineCommitter, frameBytes } from "../src/socket/line-frames.js";
import { sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, loginAdmin, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "default_project";
const AGENT = "default_agent";
const DATE = "2026-09-01";

const meta = (sid: string): AmspRecord =>
  sessionMeta({
    session_id: sid,
    provider: "custom",
    model_id: "m1",
    model_context_window: 10_000,
    system_prompt: "sp",
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
    source: "user",
  });

const task = (n: number): AmspRecord[] => [
  userText(`q${n}`),
  requestBegin(),
  assistantText(`a${n}`),
  requestEnd("completed"),
];

const heavyTask = (n: number, chars = 40_000): AmspRecord[] => [
  userText(`q${n}`),
  requestBegin(),
  toolCall({ name: "read_file", arguments: '{"path":"/w/big.txt"}', toolCallId: `t${n}` }),
  requestEnd("completed"),
  toolCallOutput({ output: `${n}`.repeat(chars), toolCallId: `t${n}`, status: "completed" }),
  requestBegin(),
  assistantText(`a${n}`),
  requestEnd("completed"),
];

interface Event {
  event: string;
  id: string | null;
  data: unknown;
}

/** The SSE text of a whole (ended) stream, as events. */
function parseSse(text: string): Event[] {
  const out: Event[] = [];
  for (const block of text.split("\n\n")) {
    if (block.trim() === "") continue;
    let event = "message";
    let id: string | null = null;
    const data: string[] = [];
    for (const l of block.split("\n")) {
      if (l.startsWith("event: ")) event = l.slice(7);
      else if (l.startsWith("id: ")) id = l.slice(4);
      else if (l.startsWith("data: ")) data.push(l.slice(6));
    }
    out.push({ event, id, data: JSON.parse(data.join("\n")) });
  }
  return out;
}

type Frame = HistoryLinesFrame | HistoryPartFrame;
const isFrame = (e: Event) => e.event === "lines" || e.event === "part";

/** A hub's copies of the files, filled by committing frames whole. */
class Copies {
  readonly bytes = new Map<string, Buffer>();
  readonly committers = new Map<string, LineCommitter>();
  readonly runs: Array<{ k: string; off: number; length: number }> = [];
  receive(events: Event[], sizes: Map<string, number>): void {
    for (const e of events.filter(isFrame)) {
      const frame = e.data as Frame;
      const committer = this.committers.get(frame.k) ?? new LineCommitter();
      this.committers.set(frame.k, committer);
      const run = committer.push(frame);
      if (run === null) continue;
      const size = Math.max(sizes.get(frame.k) ?? 0, run.off + run.bytes.length);
      let copy = this.bytes.get(frame.k) ?? Buffer.alloc(0);
      if (copy.length < size) copy = Buffer.concat([copy, Buffer.alloc(size - copy.length)]);
      run.bytes.copy(copy, run.off);
      this.bytes.set(frame.k, copy);
      this.runs.push({ k: frame.k, off: run.off, length: run.bytes.length });
    }
  }
  /** Bytes [start, end) of a file, when every byte of it was committed. */
  read = (k: string, start: number, end: number): Buffer | null => {
    let at = start;
    const runs = this.runs.filter((r) => r.k === k).sort((a, b) => a.off - b.off);
    for (const r of runs) if (r.off <= at && at < r.off + r.length) at = r.off + r.length;
    if (at < end) return null;
    return this.bytes.get(k)!.subarray(start, end);
  };
}

const sizesOf = (window: HistoryLinesWindow) => new Map(window.files.map((f) => [f.k, f.size]));

describe("history-lines, the machine leg", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  /** A Session over two shards: Tasks 1–2, then (rotated) Tasks 3–5, Task 4 heavy. */
  async function seed(): Promise<{ sid: string; paths: string[]; keys: string[] }> {
    const sid = uniqueSessionId();
    t.deps.sessionsRepo.insert(sessionRow(sid, { projectId: PROJECT, agentId: AGENT }));
    const one = await writeTraceFile(t.root, PROJECT, AGENT, DATE, sid, 1, [
      meta(sid),
      ...task(1),
      ...task(2),
    ]);
    const two = await writeTraceFile(t.root, PROJECT, AGENT, DATE, sid, 2, [
      meta(sid),
      ...task(3),
      ...heavyTask(4, 100_000), // several frames long
      ...task(5),
    ]);
    return { sid, paths: [one, two], keys: [1, 2].map((i) => historyFileKey(AGENT, sid, i)) };
  }

  async function lines(sid: string, query: string): Promise<Event[]> {
    const res = await api.get(`/api/sessions/${sid}/history-lines?${query}`);
    expect(res.status).toBe(200);
    return parseSse(await res.text());
  }

  const windowOf = (events: Event[]) => events[0]!.data as HistoryLinesWindow;

  /** What the hub holds of a file it committed whole up to `hi`. */
  async function haveOf(path: string, k: string, copy: Buffer, hi: number): Promise<HistoryHave> {
    const st = await fs.stat(path);
    return {
      k,
      ino: st.ino,
      birthtimeMs: st.birthtimeMs,
      lo: 0,
      loOrd: 0,
      hi,
      loAnchor: anchorOf(copy.subarray(...loAnchorRange(0, hi))),
      hiAnchor: anchorOf(copy.subarray(...hiAnchorRange(0, hi))),
    };
  }

  it("with nothing held: newest first, ready before heavy and fill, and every file arrives whole", async () => {
    const { sid, paths, keys } = await seed();
    const events = await lines(sid, "tailLimit=4&fill=1");
    expect(events.map((e) => e.event).filter((n) => !isFrame({ event: n } as Event))).toEqual([
      "window",
      "ready",
      "done",
    ]);
    const window = windowOf(events);
    expect(window.layout.map((s) => s.k)).toEqual([keys[0], keys[1]]);
    expect(window.files.map((f) => [f.k, f.final])).toEqual([
      [keys[0], true],
      [keys[1], false],
    ]);
    const ready = events.findIndex((e) => e.event === "ready");
    const windowFrames = events
      .slice(1, ready)
      .filter(isFrame)
      .map((e) => e.data as Frame);
    // The newest segment's lines come first.
    expect(windowFrames[0]!.k).toBe(keys[1]);
    // The heavy output rides as a stub, folded; its line comes only after `ready`.
    expect(window.stubs).toHaveLength(1);
    const stub = window.stubs[0]!;
    expect(stub.record.elided?.map((e) => e.path)).toEqual(["payload.output"]);
    expect(
      windowFrames.some((f) => f.off <= stub.offset && stub.offset < f.off + frameBytes(f).length),
    ).toBe(false);

    const early = new Copies();
    early.receive(events.slice(0, ready), sizesOf(window));
    const assembledEarly = await assembleWindow(window.layout, early.read, window.stubs);
    const page = (await (await api.get(`/api/sessions/${sid}/messages?tailLimit=4`)).json()) as {
      messages: HistoryMessage[];
    };
    expect(assembledEarly).toEqual(
      page.messages.map((m) =>
        m.tracePosition?.ordinal === stub.ordinal && m.tracePosition.fileIndex === 2
          ? stub.record
          : m,
      ),
    );

    const all = new Copies();
    all.receive(events, sizesOf(window));
    for (let i = 0; i < 2; i++)
      expect(all.bytes.get(keys[i]!)).toEqual(await fs.readFile(paths[i]!));
    expect(await assembleWindow(window.layout, all.read)).toEqual(page.messages);
    // The totals announced exactly what came, phase by phase.
    const sent = (from: number, to: number) =>
      events
        .slice(from, to)
        .filter(isFrame)
        .reduce((n, e) => n + frameBytes(e.data as Frame).length, 0);
    expect(window.totals.window.bytes).toBe(sent(1, ready));
    expect(window.totals.heavy.bytes).toBe(stub.length);
    expect(window.totals.window.bytes + window.totals.heavy.bytes + window.totals.fill.bytes).toBe(
      (await fs.stat(paths[0]!)).size + (await fs.stat(paths[1]!)).size,
    );
    expect(sent(ready, events.length)).toBe(window.totals.heavy.bytes + window.totals.fill.bytes);
  });

  it("a valid have gets only what is past its hi, and nothing of a final file it holds whole", async () => {
    const { sid, paths, keys } = await seed();
    const first = await lines(sid, "tailLimit=2&fill=1");
    const copies = new Copies();
    copies.receive(first, sizesOf(windowOf(first)));
    const oldSize = (await fs.stat(paths[1]!)).size;
    const appended = [userText("q6"), assistantText("a6"), requestEnd("completed")]
      .map((m) => `${JSON.stringify(m)}\n`)
      .join("");
    await fs.appendFile(paths[1]!, appended);
    const have = [
      await haveOf(
        paths[0]!,
        keys[0]!,
        copies.bytes.get(keys[0]!)!,
        (await fs.stat(paths[0]!)).size,
      ),
      await haveOf(paths[1]!, keys[1]!, copies.bytes.get(keys[1]!)!, oldSize),
    ];
    const again = await lines(sid, `tailLimit=2&fill=1&have=${encodeHistoryHave(have)}`);
    expect(windowOf(again).files.every((f) => f.reset === undefined)).toBe(true);
    const frames = again.filter(isFrame).map((e) => e.data as Frame);
    expect(frames.every((f) => f.k === keys[1])).toBe(true);
    expect(Buffer.concat(frames.map(frameBytes)).toString()).toBe(appended);
    expect(frames[0]!.off).toBe(oldSize);
  });

  it("a held partial line is continued from where it stopped", async () => {
    const { sid, paths, keys } = await seed();
    const first = await lines(sid, "tailLimit=4");
    const window = windowOf(first);
    const stub = window.stubs[0]!;
    // Cut the stream after the heavy line's second part.
    let parts = 0;
    const cut = first.findIndex((e) => e.event === "part" && ++parts === 2) + 1;
    const copies = new Copies();
    copies.receive(first.slice(0, cut), sizesOf(window));
    const held = copies.committers.get(keys[1]!)!.partial()!;
    expect(held.off).toBe(stub.offset);
    const have: HistoryHave = {
      ...(await haveOf(paths[1]!, keys[1]!, copies.bytes.get(keys[1]!)!, 0)),
      partial: { off: held.off, len: held.bytes.length, anchor: anchorOf(held.bytes) },
    };
    const again = await lines(sid, `tailLimit=4&have=${encodeHistoryHave([have])}`);
    const heavyParts = again
      .filter((e) => e.event === "part")
      .map((e) => e.data as HistoryPartFrame);
    expect(heavyParts[0]!.off).toBe(held.off + held.bytes.length);
    copies.receive(again, sizesOf(windowOf(again)));
    expect(copies.read(keys[1]!, stub.offset, stub.offset + stub.length)).toEqual(
      (await fs.readFile(paths[1]!)).subarray(stub.offset, stub.offset + stub.length),
    );
  });

  it.each(["a wrong anchor", "a new inode", "a file that shrank"])(
    "%s resets the file and sends it from scratch",
    async (change) => {
      const { sid, paths, keys } = await seed();
      const first = await lines(sid, "tailLimit=1&fill=1");
      const copies = new Copies();
      copies.receive(first, sizesOf(windowOf(first)));
      const size = (await fs.stat(paths[0]!)).size;
      let have = await haveOf(paths[0]!, keys[0]!, copies.bytes.get(keys[0]!)!, size);
      const original = await fs.readFile(paths[0]!);
      if (change === "a wrong anchor") have = { ...have, hiAnchor: anchorOf(Buffer.from("x")) };
      if (change === "a new inode") {
        await fs.writeFile(`${paths[0]!}.tmp`, original);
        await fs.rename(`${paths[0]!}.tmp`, paths[0]!);
      }
      if (change === "a file that shrank") {
        await fs.writeFile(paths[0]!, original.subarray(0, original.indexOf(0x0a) + 1));
      }
      const again = await lines(sid, `fill=only&have=${encodeHistoryHave([have])}`);
      const fact = windowOf(again).files.find((f) => f.k === keys[0]);
      expect(fact?.reset).toBe(true);
      const sent = again
        .filter((e) => isFrame(e) && (e.data as Frame).k === keys[0])
        .reduce((n, e) => n + frameBytes(e.data as Frame).length, 0);
      expect(sent).toBe((await fs.stat(paths[0]!)).size);
    },
  );

  it("a file that vanished is absent from the window's files", async () => {
    const { sid, paths, keys } = await seed();
    await lines(sid, "tailLimit=1");
    await fs.rm(paths[0]!);
    const again = await lines(sid, "tailLimit=1");
    expect(windowOf(again).files.map((f) => f.k)).toEqual([keys[1]]);
  });

  it("body= sends exactly that one line; a ref into no line of the Session is a 404", async () => {
    const { sid, paths } = await seed();
    const window = windowOf(await lines(sid, "tailLimit=1"));
    expect(window.stubs).toEqual([]);
    const stub = windowOf(await lines(sid, "tailLimit=2")).stubs[0]!;
    const ref = stub.record.elided![0]!.ref;
    const events = await lines(sid, `body=${ref}`);
    expect(events.map((e) => e.event).filter((n) => n !== "part" && n !== "lines")).toEqual([
      "window",
      "ready",
      "done",
    ]);
    const bytes = Buffer.concat(events.filter(isFrame).map((e) => frameBytes(e.data as Frame)));
    expect(bytes).toEqual(
      (await fs.readFile(paths[1]!)).subarray(stub.offset, stub.offset + stub.length),
    );

    const other = await seed();
    const res = await api.get(`/api/sessions/${other.sid}/history-lines?body=${ref}`);
    expect(res.status).toBe(404);
    await res.text();
  });

  it("a budget holds the newest whole Tasks whose folded records fit, and before windows continue", async () => {
    const sid = uniqueSessionId();
    t.deps.sessionsRepo.insert(sessionRow(sid, { projectId: PROJECT, agentId: AGENT }));
    await writeTraceFile(t.root, PROJECT, AGENT, DATE, sid, 1, [
      meta(sid),
      ...Array.from({ length: 8 }, (_, i) => heavyTask(i + 1)).flat(),
    ]);
    const prompts = (records: HistoryMessage[]) =>
      records
        .filter(
          (m) =>
            (m.payload as { type?: string; role?: string }).role === "user" &&
            (m.payload as { type?: string }).type === "text",
        )
        .map((m) => (m.payload as { text: string }).text);
    async function windowAt(query: string) {
      const events = await lines(sid, query);
      const window = windowOf(events);
      const copies = new Copies();
      copies.receive(events, sizesOf(window));
      return { window, records: (await assembleWindow(window.layout, copies.read, window.stubs))! };
    }
    const tiny = await windowAt("tailLimit=20&budget=1");
    expect(prompts(tiny.records)).toEqual(["q8"]);
    expect(tiny.window.envelope.page?.before).toBeDefined();

    // 10 KiB holds a few folded Tasks; any one of them whole is four times that.
    const budget = 10 * 1024;
    const newest = await windowAt(`tailLimit=20&budget=${budget}`);
    const held = prompts(newest.records);
    expect(held.length).toBeGreaterThan(1);
    expect(held.length).toBeLessThan(8);
    expect(held.at(-1)).toBe("q8");
    // Back to the beginning, window by window: together they are the transcript, once each.
    const seen = [...held];
    let before = newest.window.envelope.page?.before;
    while (before !== undefined) {
      const older = await windowAt(`before=${before}&limit=20&budget=${budget}`);
      seen.unshift(...prompts(older.records));
      before = older.window.envelope.page?.before;
    }
    expect(seen).toEqual(Array.from({ length: 8 }, (_, i) => `q${i + 1}`));
  });
});
