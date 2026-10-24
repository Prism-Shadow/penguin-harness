/**
 * SessionReader against the package's fetch fake: following a Session from its history into its
 * live stream, the way the Web App's stream controller does.
 *
 * - Given an idle Session, the reader subscribes first, reads the tail history once the stream
 *   speaks, delivers it as history, then what streams after as live.
 * - Given records that arrive while the history is read, a complete record the history already
 *   holds is delivered once, and the rest follow it.
 * - Given a running Session, held fragments at or before the history's live cursor are dropped,
 *   the live snapshot takes their place, and the fragments after the cursor follow.
 * - Given a reopen the server refuses 409 `resync_required`, a reset is announced and the reader
 *   opens as the first time: the stream without `Last-Event-ID`, then the history under it, then
 *   what streams after.
 * - Given a stream that carried a heartbeat and then 50 s of silence, it is reopened with the
 *   last record's id as `Last-Event-ID`; a stream that ends is reopened the same way after the
 *   pause, and nothing is delivered twice.
 * - Given a stream the server refuses with a 404, an error is announced and nothing reopens.
 * - Given close(), the connection closes and nothing more is delivered.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AmspHttpError, HttpTransport, SessionReader } from "../src/index.js";
import type { AmspRecord, ReaderEvent } from "../src/index.js";
import { BASE_URL, control, createFetchFake, frame, gate, never } from "./helpers/fetch-fake.js";
import type { FetchFake } from "./helpers/fetch-fake.js";
import { assistantText, partialText, taskBegin, taskEnd, userText } from "./helpers/streams.js";

const SID = "session-2026-10-23-10-00-00-0000bbbb";
const STREAM = `/sessions/${SID}/stream`;
const HISTORY = `/sessions/${SID}/messages?tailLimit=20`;

function readerOf(fake: FetchFake): {
  reader: SessionReader;
  seen: string[];
  resets: () => number;
} {
  const reader = new SessionReader(
    new HttpTransport({ baseUrl: BASE_URL, apiKey: "penguin_key", fetch: fake.fetch }),
    SID,
    { reconnectMs: 1000 },
  );
  const seen: string[] = [];
  let resets = 0;
  reader.on("event", (ev: ReaderEvent) => seen.push(`${ev.source}:${label(ev.record)}`));
  reader.on("reset", () => {
    resets += 1;
    seen.push("reset");
  });
  return { reader, seen, resets: () => resets };
}

/** A record as the assertions name it: its payload type and its text, if any. */
function label(rec: AmspRecord): string {
  const p = rec.payload as { type?: string; text?: string; event_type?: string };
  const what = p.event_type ? `${p.type}.${p.event_type}` : (p.type ?? rec.type);
  return p.text ? `${what}(${p.text})` : what;
}

/** Waits for the reader's queued work: microtasks and the fake's pulls. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionReader", () => {
  it("reads the history once the stream speaks, then delivers what streams after it", async () => {
    const fake = createFetchFake();
    const h1 = userText("hello");
    const h2 = assistantText("hi");
    fake.json("GET", HISTORY, 200, { messages: [h1, h2] });
    const next = taskBegin();
    fake.stream("GET", STREAM, [
      control("ping"),
      () => fake.requested("GET", HISTORY),
      frame(next, "e-3"),
      never(),
    ]);
    const { reader, seen } = readerOf(fake);
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(seen).toEqual(["history:text(hello)", "history:text(hi)", "live:task_begin"]);
    // Subscribed first, history second.
    expect(fake.calls.map((c) => c.path)).toEqual([STREAM, HISTORY]);
    reader.close();
  });

  it("delivers a record the history already holds once", async () => {
    const fake = createFetchFake();
    const h1 = userText("hello");
    const h2 = assistantText("hi");
    const after = taskEnd();
    const both = gate();
    fake.json("GET", HISTORY, 200, { messages: [h1, h2] }, both.promise);
    fake.stream("GET", STREAM, [
      control("ping"),
      frame(h2, "e-2"),
      frame(after, "e-3"),
      async () => both.open(),
      never(),
    ]);
    const { reader, seen } = readerOf(fake);
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(seen).toEqual(["history:text(hello)", "history:text(hi)", "live:task_end"]);
    reader.close();
  });

  it("weaves the live snapshot in place of the fragments it already holds", async () => {
    const fake = createFetchFake();
    const held = gate();
    fake.json(
      "GET",
      HISTORY,
      200,
      {
        messages: [taskBegin(), userText("go")],
        live: { cursor: "ep-2", fragments: [partialText("start", "Hel")] },
      },
      held.promise,
    );
    fake.stream("GET", STREAM, [
      control("ping"),
      frame(partialText("start"), "ep-1"),
      frame(partialText("delta", "Hel"), "ep-2"),
      frame(partialText("delta", "lo"), "ep-3"),
      async () => held.open(),
      never(),
    ]);
    const { reader, seen } = readerOf(fake);
    await vi.waitFor(() => expect(seen).toHaveLength(4));
    expect(seen).toEqual([
      "history:task_begin",
      "history:text(go)",
      "live:partial_text.start(Hel)",
      "live:partial_text.delta(lo)",
    ]);
    reader.close();
  });

  it("starts over as on a first open when a reopen is refused resync_required", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = createFetchFake();
    const first = userText("one");
    const second = assistantText("two");
    fake.json("GET", HISTORY, 200, { messages: [first] });
    fake.json("GET", HISTORY, 200, { messages: [first, second] });
    fake.stream("GET", STREAM, [control("ping"), frame(taskBegin(), "e-1")]);
    fake.json("GET", STREAM, 409, {
      error: { code: "resync_required", message: "The id has left the buffer." },
    });
    fake.stream("GET", STREAM, [control("ping"), frame(taskEnd(), "f-1"), never()]);
    const { reader, seen, resets } = readerOf(fake);
    await vi.waitFor(() => expect(seen).toEqual(["history:text(one)", "live:task_begin"]));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(seen).toHaveLength(6));
    expect(seen.slice(2)).toEqual([
      "reset",
      "history:text(one)",
      "history:text(two)",
      "live:task_end",
    ]);
    expect(resets()).toBe(1);
    const streams = fake.calls.filter((c) => c.path === STREAM);
    expect(streams.map((c) => c.headers.get("last-event-id"))).toEqual([null, "e-1", null]);
    reader.close();
  });

  it("reopens a stream silent for 50 s after a heartbeat, from the last record's id", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = createFetchFake();
    fake.json("GET", HISTORY, 200, { messages: [] });
    fake.stream("GET", STREAM, [control("ping"), frame(taskBegin(), "e-1"), never()], {
      abortErrorsBody: true,
    });
    fake.stream("GET", STREAM, [frame(taskEnd(), "e-2"), never()]);
    const { reader, seen } = readerOf(fake);
    await vi.waitFor(() => expect(seen).toEqual(["live:task_begin"]));
    await vi.advanceTimersByTimeAsync(49_000);
    expect(fake.calls.filter((c) => c.path === STREAM)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    const streams = fake.calls.filter((c) => c.path === STREAM);
    expect(streams).toHaveLength(2);
    expect(streams[0]!.signal?.aborted).toBe(true);
    expect(streams[1]!.headers.get("last-event-id")).toBe("e-1");
    await vi.waitFor(() => expect(seen).toEqual(["live:task_begin", "live:task_end"]));
    reader.close();
  });

  it("reopens a stream that ended, after the pause, from the last record's id", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = createFetchFake();
    fake.json("GET", HISTORY, 200, { messages: [] });
    fake.stream("GET", STREAM, [control("ping"), frame(taskBegin(), "e-1")]);
    fake.stream("GET", STREAM, [frame(taskEnd(), "e-2"), never()]);
    const { reader, seen } = readerOf(fake);
    await vi.waitFor(() => expect(seen).toEqual(["live:task_begin"]));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(seen).toEqual(["live:task_begin", "live:task_end"]));
    expect(fake.calls.filter((c) => c.path === STREAM)[1]!.headers.get("last-event-id")).toBe(
      "e-1",
    );
    reader.close();
  });

  it("stops with an error when the server refuses the stream", async () => {
    const fake = createFetchFake();
    const { reader } = readerOf(fake);
    const failed = new Promise<unknown>((resolve) => reader.on("error", resolve));
    const error = await failed;
    expect(error).toBeInstanceOf(AmspHttpError);
    expect((error as AmspHttpError).status).toBe(404);
    await settle();
    expect(fake.calls.filter((c) => c.path === STREAM)).toHaveLength(1);
  });

  it("closes the connection on close() and delivers nothing more", async () => {
    const fake = createFetchFake();
    const later = gate();
    fake.json("GET", HISTORY, 200, { messages: [] });
    const served = fake.stream("GET", STREAM, [
      control("ping"),
      later.promise,
      frame(taskBegin(), "e-1"),
      never(),
    ]);
    const { reader, seen } = readerOf(fake);
    await fake.requested("GET", HISTORY);
    reader.close();
    later.open();
    await settle();
    expect(seen).toEqual([]);
    expect(served.closed).toBe(true);
  });
});
