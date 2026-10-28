/**
 * History's live snapshot can arrive before the stream delivers the frames it already covers.
 *
 * - Given a live text or tool-call snapshot, late partials at/before its cursor are omitted,
 *   while complete records and partials after the cursor are delivered.
 * - Given a partial with no comparable id, it is delivered rather than assumed covered.
 * - Given a resumed stream after covered partials, its Last-Event-ID advances and the snapshot
 *   still filters covered replay until new partials arrive.
 * - Given an invalid or foreign-epoch snapshot, neither its seed nor its cutoff is adopted.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpTransport, SessionReader } from "../src/index.js";
import type { AmspRecord } from "../src/index.js";
import { BASE_URL, control, createFetchFake, frame, gate, never } from "./helpers/fetch-fake.js";
import { assistantText, partialText, partialToolCall } from "./helpers/streams.js";

const SID = "snapshot-session";
const STREAM = `/sessions/${SID}/stream`;
const HISTORY = `/sessions/${SID}/messages?tailLimit=20`;

afterEach(() => vi.useRealTimers());

describe("SessionReader snapshot overlap", () => {
  it.each(["text", "tool"])(
    "does not replay late %s fragments already in the snapshot",
    async (kind) => {
      vi.useFakeTimers();
      const fake = createFetchFake();
      const late = gate();
      const make =
        kind === "text"
          ? partialText
          : (event: "start" | "delta" | "stop", value = "") =>
              partialToolCall("call-1", event, value);
      const seed = make("start", "prefix");
      const complete = assistantText("complete", ["helper"]);
      const suffix = make("delta", "suffix");
      fake.json("GET", HISTORY, 200, { messages: [], live: { cursor: "ep-3", fragments: [seed] } });
      fake.stream("GET", STREAM, [
        control("ping"),
        late.promise,
        frame(make("start"), "ep-1"),
        frame(make("delta", "prefix"), "ep-2"),
        frame(complete, "ep-3"),
        frame(suffix, "ep-4"),
        never(),
      ]);
      const reader = new SessionReader(
        new HttpTransport({ baseUrl: BASE_URL, fetch: fake.fetch }),
        SID,
      );
      const seen: AmspRecord[] = [];
      reader.on("event", ({ record }) => seen.push(record));
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([seed]);
        late.open();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([seed, complete, suffix]);
      } finally {
        reader.close();
      }
    },
  );

  it.each([undefined, "unparsed", "other-1"])(
    "keeps partials with incomparable id %s",
    async (id) => {
      vi.useFakeTimers();
      const fake = createFetchFake();
      const late = gate();
      const seed = partialText("start", "prefix");
      const next = partialText("delta", "new");
      fake.json("GET", HISTORY, 200, { messages: [], live: { cursor: "ep-3", fragments: [seed] } });
      fake.stream("GET", STREAM, [control("ping"), late.promise, frame(next, id), never()]);
      const reader = new SessionReader(
        new HttpTransport({ baseUrl: BASE_URL, fetch: fake.fetch }),
        SID,
      );
      const seen: AmspRecord[] = [];
      reader.on("event", ({ record }) => seen.push(record));
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([seed]);
        late.open();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([seed, next]);
      } finally {
        reader.close();
      }
    },
  );

  it("resumes after covered frames and filters the remaining overlap", async () => {
    vi.useFakeTimers();
    const fake = createFetchFake();
    const late = gate();
    const seed = partialText("start", "prefix");
    const suffix = partialText("delta", "suffix");
    fake.json("GET", HISTORY, 200, { messages: [], live: { cursor: "ep-3", fragments: [seed] } });
    fake.stream("GET", STREAM, [
      control("ping"),
      late.promise,
      frame(partialText("delta", "pre"), "ep-2"),
    ]);
    fake.stream("GET", STREAM, [
      frame(partialText("delta", "fix"), "ep-3"),
      frame(suffix, "ep-4"),
      never(),
    ]);
    const reader = new SessionReader(
      new HttpTransport({ baseUrl: BASE_URL, fetch: fake.fetch }),
      SID,
    );
    const seen: AmspRecord[] = [];
    reader.on("event", ({ record }) => seen.push(record));
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual([seed]);
      late.open();
      await vi.advanceTimersByTimeAsync(1_000);
      const streams = fake.calls.filter((call) => call.path === STREAM);
      expect(streams).toHaveLength(2);
      expect(streams[1]!.headers.get("last-event-id")).toBe("ep-2");
      expect(fake.calls.filter((call) => call.path === HISTORY)).toHaveLength(1);
      expect(seen).toEqual([seed, suffix]);
    } finally {
      reader.close();
    }
  });

  it.each(["unparsed", "other-3"])(
    "does not use rejected snapshot cursor %s to filter later records",
    async (cursor) => {
      vi.useFakeTimers();
      const fake = createFetchFake();
      const history = gate();
      const late = gate();
      const first = partialText("start", "first");
      const next = partialText("delta", "next");
      fake.json(
        "GET",
        HISTORY,
        200,
        {
          messages: [],
          live: {
            cursor,
            fragments: [partialText("start", "wrong snapshot")],
          },
        },
        history.promise,
      );
      fake.stream("GET", STREAM, [
        control("ping"),
        frame(first, "ep-1"),
        late.promise,
        frame(next, "other-2"),
        never(),
      ]);
      const reader = new SessionReader(
        new HttpTransport({ baseUrl: BASE_URL, fetch: fake.fetch }),
        SID,
      );
      const seen: AmspRecord[] = [];
      reader.on("event", ({ record }) => seen.push(record));
      try {
        await vi.advanceTimersByTimeAsync(0);
        history.open();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([first]);
        late.open();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([first, next]);
      } finally {
        reader.close();
      }
    },
  );
});
