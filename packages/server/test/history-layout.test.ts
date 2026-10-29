/**
 * A history window as the Trace bytes it was read from, and back (services/history-layout.ts):
 * what a hub that holds only those bytes rebuilds must be exactly what the machine read.
 *
 * Fixture: a Session over two shards, rotated in the middle of a Task, holding blank and
 * malformed lines and ending in a record not yet followed by its newline; a child with a
 * grandchild under another Agent; a pointer whose child Trace is gone; a chain of children
 * deeper than the expansion goes; a child that points back at the Session.
 *
 * - Given tail windows of several sizes, the `before` windows that follow them to the
 *   beginning, and the full transcript, the records assembled from the layout — with only the
 *   bytes the layout names on hand — equal the records the trace service read.
 * - Given the same reads, tracking where each record came from changes none of them.
 * - Given a stub for a line that is not on hand, the window still assembles, with the stub's
 *   record in that line's place.
 * - Given a run that is not on hand, or bytes that hold another record count than the layout
 *   names (a file rewritten since), assembly refuses rather than answer wrong.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assistantText,
  requestBegin,
  requestEnd,
  sessionMeta,
  subagentEvent,
  toolCall,
  toolCallOutput,
  userText,
} from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import type { HistorySegment, HistoryStub } from "../src/api/types.js";
import { assembleWindow, windowLayout } from "../src/services/history-layout.js";
import type { LineOffsets } from "../src/services/history-layout.js";
import { decodeCursor } from "../src/services/message-window.js";
import type { HistoryWindowRead, TraceService } from "../src/services/trace-service.js";
import { historyFileKey } from "../src/services/history-wire.js";
import { makeTempRoot, makeTraceHarness, removeTempRoot } from "./helpers.js";

const P = "proj";
const A = "default_agent";
const W = "worker";
const S = "session-2026-07-09-10-00-00-aaaa0001";
const CHILD = "session-2026-07-09-10-00-01-bbbb0002";
const GRAND = "session-2026-07-09-10-00-02-cccc0003";
const GONE = "session-2026-07-09-10-00-03-dddd0004";
const CYCLE = "session-2026-07-09-10-00-04-eeee0005";
const DEEP = [1, 2, 3, 4, 5].map((n) => `session-2026-07-09-10-01-0${n}-ffff000${n}`);

const meta = (sessionId: string, agentId: string): AmspRecord =>
  sessionMeta({
    session_id: sessionId,
    model_id: "m",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "",
    agent_state: `/root/${P}/${agentId}/agent_state`,
    workspace: "/tmp/w",
    source: "user",
  });

const line = (m: AmspRecord) => `${JSON.stringify(m)}\n`;

/** A Trace file from raw text: lines as given, so blank, malformed and torn lines can be written. */
async function writeRaw(
  root: string,
  agentId: string,
  sessionId: string,
  index: number,
  text: string,
): Promise<string> {
  const dir = path.join(root, P, "agents", agentId, "traces", "2026-07-09");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}_${String(index).padStart(3, "0")}.jsonl`);
  await fs.writeFile(file, text);
  return file;
}

const task = (n: number, extra: AmspRecord[] = []): string =>
  [userText(`q${n}`), requestBegin(), ...extra, assistantText(`a${n}`), requestEnd("completed")]
    .map(line)
    .join("");

describe("history layout", () => {
  let root: string;
  let harness: ReturnType<typeof makeTraceHarness>;
  let svc: TraceService;
  /** Every file of the fixture, by key: its bytes and line offsets. */
  const files = new Map<string, { bytes: Buffer; offsets: LineOffsets }>();

  beforeAll(async () => {
    root = await makeTempRoot();
    await writeRaw(
      root,
      A,
      S,
      1,
      line(meta(S, A)) +
        task(1) +
        task(2, [
          toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "t2" }),
          subagentEvent(CHILD),
        ]) +
        "\n   \n{not json\n" +
        task(3, [subagentEvent(GONE)]) +
        line(userText("q4")) +
        line(requestBegin()),
    );
    await writeRaw(
      root,
      A,
      S,
      2,
      line(meta(S, A)) +
        line(assistantText("a4")) +
        line(requestEnd("completed")) +
        task(5, [subagentEvent(DEEP[0]!)]) +
        task(6, [subagentEvent(CYCLE)]) +
        task(7, [
          toolCallOutput({ output: "y".repeat(40_000), toolCallId: "t7", status: "completed" }),
        ]) +
        JSON.stringify(userText("q8")), // a record not yet followed by its newline
    );
    await writeRaw(
      root,
      W,
      CHILD,
      1,
      line(meta(CHILD, W)) +
        line(userText("do it", "parent_agent")) +
        line(subagentEvent(GRAND)) +
        line(assistantText("child done")),
    );
    await writeRaw(root, W, GRAND, 1, line(meta(GRAND, W)) + line(assistantText("grand done")));
    await writeRaw(
      root,
      W,
      CYCLE,
      1,
      line(meta(CYCLE, W)) + line(subagentEvent(S)) + line(assistantText("cycle done")),
    );
    for (let i = 0; i < DEEP.length; i++) {
      const next = DEEP[i + 1];
      await writeRaw(
        root,
        W,
        DEEP[i]!,
        1,
        line(meta(DEEP[i]!, W)) +
          line(assistantText(`deep ${i + 1}`)) +
          (next !== undefined ? line(subagentEvent(next)) : ""),
      );
    }
    harness = makeTraceHarness(root);
    svc = harness.service;
    for (const file of await svc.historyTraceFiles(P, A, S)) {
      files.set(historyFileKey(file.agentId, file.sessionId, file.fileIndex), {
        bytes: await fs.readFile(file.path),
        offsets: { starts: file.starts, ends: file.ends },
      });
    }
  });
  afterAll(async () => {
    harness.close();
    await removeTempRoot(root);
  });

  /** Only the bytes the layout names, as a hub holding nothing else would serve them. */
  const onlyLayoutBytes =
    (layout: readonly HistorySegment[], refuse: Array<[string, number]> = []) =>
    (k: string, start: number, end: number): Buffer | null => {
      const named = layout.some((s) => s.k === k && s.from[0] <= start && end <= s.to[0]);
      const refused = refuse.some(([rk, off]) => rk === k && start <= off && off < end);
      if (!named || refused) return null;
      return files.get(k)!.bytes.subarray(start, end);
    };

  const layoutOf = (read: HistoryWindowRead) =>
    windowLayout(read.messages, read.sources, (k) => files.get(k)?.offsets ?? null);

  /** The tail window and every `before` window behind it, to the beginning. */
  async function windows(limit: number): Promise<HistoryWindowRead[]> {
    const out: HistoryWindowRead[] = [];
    let read = await svc.readHistoryWindow(P, A, S, { kind: "tail", limit });
    out.push(read);
    while (read.page?.before !== undefined) {
      read = await svc.readHistoryWindow(P, A, S, {
        kind: "before",
        cursor: decodeCursor(read.page.before)!,
        limit,
      });
      out.push(read);
    }
    return out;
  }

  it.each([1, 2, 3, 20])(
    "tail windows of %i Tasks and the before windows behind them assemble from their own bytes",
    async (limit) => {
      const reads = await windows(limit);
      expect(reads.length).toBeGreaterThan(limit === 20 ? 0 : 1);
      for (const read of reads) {
        const layout = layoutOf(read);
        expect(await assembleWindow(layout, onlyLayoutBytes(layout))).toEqual(read.messages);
      }
    },
  );

  it("the full transcript assembles from its own bytes", async () => {
    const read = await svc.readHistoryWindow(P, A, S, { kind: "full" });
    // Every kind of record the fixture holds is in it: children two levels down, the kept
    // pointers (gone, too deep, cyclic), the record without its newline.
    const origins = new Set(read.messages.map((m) => (m.origin ?? []).join(">")));
    expect(origins).toContain(`${CHILD}>${GRAND}`);
    expect(origins).toContain(DEEP.slice(0, 4).join(">"));
    expect(read.messages.at(-1)).toMatchObject({ payload: { text: "q8" } });
    const layout = layoutOf(read);
    expect(await assembleWindow(layout, onlyLayoutBytes(layout))).toEqual(read.messages);
  });

  it("tracking where each record came from changes none of the reads", async () => {
    const tail = await svc.readHistoryWindow(P, A, S, { kind: "tail", limit: 2 });
    const page = await svc.readMessagesPage(P, A, S, { kind: "tail", limit: 2 });
    expect(tail.messages).toEqual(page.messages);
    expect(tail.page?.before).toBe(page.before);
    const before = { kind: "before" as const, cursor: decodeCursor(page.before!)!, limit: 2 };
    expect((await svc.readHistoryWindow(P, A, S, before)).messages).toEqual(
      (await svc.readMessagesPage(P, A, S, before)).messages,
    );
    expect((await svc.readHistoryWindow(P, A, S, { kind: "full" })).messages).toEqual(
      await svc.readMessages(P, A, S),
    );
  });

  it("a stub stands in for a line that is not on hand", async () => {
    const read = await svc.readHistoryWindow(P, A, S, { kind: "tail", limit: 2 });
    const layout = layoutOf(read);
    const at = read.messages.findIndex(
      (m) => (m.payload as { type?: string }).type === "tool_call_output",
    );
    const source = read.sources[at]!;
    const k = historyFileKey(source.agentId, source.sessionId, source.fileIndex);
    const offsets = files.get(k)!.offsets;
    const stub: HistoryStub = {
      k,
      ordinal: source.ordinal,
      offset: offsets.starts[source.ordinal]!,
      length: offsets.ends[source.ordinal]! - offsets.starts[source.ordinal]!,
      record: {
        ...read.messages[at]!,
        payload: { ...read.messages[at]!.payload, output: "y…y" },
      } as never,
    };
    const bytes = onlyLayoutBytes(layout, [[k, stub.offset]]);
    expect(await assembleWindow(layout, bytes)).toBeNull();
    const assembled = await assembleWindow(layout, bytes, [stub]);
    expect(assembled).toEqual(read.messages.map((m, i) => (i === at ? stub.record : m)));
  });

  it("a run not on hand, or bytes that hold another record count, refuse to assemble", async () => {
    const read = await svc.readHistoryWindow(P, A, S, { kind: "tail", limit: 3 });
    const layout = layoutOf(read);
    const first = layout[0]!;
    expect(
      await assembleWindow(layout, onlyLayoutBytes(layout, [[first.k, first.from[0]]])),
    ).toBeNull();
    // The run's range now holds one record more than the layout names.
    const more = line(userText("other")).repeat(first.to[1] - first.from[1] + 1);
    const rewritten = (k: string, start: number, end: number) =>
      k === first.k ? Buffer.from(more) : files.get(k)!.bytes.subarray(start, end);
    expect(await assembleWindow(layout, rewritten)).toBeNull();
  });
});
