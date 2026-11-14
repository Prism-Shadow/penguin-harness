/**
 * SessionReader recovery when history reads fail while the stream is still active.
 *
 * - Given a transient history failure, incoming records and pings do not shorten the retry
 *   delay; repeated failures each wait, and recovery delivers the held records once.
 * - Given pending history and stream retries, closing the reader cancels both: no requests follow.
 * - Given a fresh connection after the watchdog resets an idle stream, the old history retry
 *   cannot shorten the new connection's retry delay.
 * - Given a history response that arrives after a fresh connection starts, its records or
 *   refusal are ignored, and the new connection's history retry still recovers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpTransport, SessionReader } from "../src/index.js";
import type { ReaderEvent } from "../src/index.js";
import { BASE_URL, control, createFetchFake, frame, gate, never } from "./helpers/fetch-fake.js";
import { assistantText, taskBegin, taskEnd } from "./helpers/streams.js";

const SID = "retry-session";
const STREAM = `/sessions/${SID}/stream`;
const HISTORY = `/sessions/${SID}/messages?tailLimit=20`;
const unavailable = { error: { code: "unavailable", message: "Try again later" } };

afterEach(() => vi.useRealTimers());

describe("SessionReader history retry delay", () => {
  it.each(["ping", "record"])(
    "waits through incoming %s frames after each failure",
    async (kind) => {
      vi.useFakeTimers();
      const fake = createFetchFake();
      const first = gate();
      const second = gate();
      const record = taskBegin();
      const held = taskEnd();
      const incoming = kind === "ping" ? control("ping") : frame(record, "ep-1");
      fake.json("GET", HISTORY, 503, unavailable);
      fake.json("GET", HISTORY, 503, unavailable);
      fake.json("GET", HISTORY, 200, { messages: [record] });
      fake.stream("GET", STREAM, [
        control("ping"),
        first.promise,
        incoming,
        second.promise,
        kind === "ping" ? control("ping") : frame(held, "ep-2"),
        never(),
      ]);
      const reader = new SessionReader(
        new HttpTransport({ baseUrl: BASE_URL, fetch: fake.fetch }),
        SID,
      );
      const seen: ReaderEvent[] = [];
      reader.on("event", (event) => seen.push(event));
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(fake.calls.filter((c) => c.path === HISTORY)).toHaveLength(1);
        first.open();
        await vi.advanceTimersByTimeAsync(999);
        expect(fake.calls.filter((c) => c.path === HISTORY)).toHaveLength(1);
        expect(seen).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(fake.calls.filter((c) => c.path === HISTORY)).toHaveLength(2);
        second.open();
        await vi.advanceTimersByTimeAsync(999);
        expect(fake.calls.filter((c) => c.path === HISTORY)).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(fake.calls.filter((c) => c.path === HISTORY)).toHaveLength(3);
        expect(seen.map((event) => [event.source, event.record])).toEqual(
          kind === "ping"
            ? [["history", record]]
            : [
                ["history", record],
                ["live", held],
              ],
        );
        expect(fake.calls.filter((c) => c.path === STREAM)).toHaveLength(1);
      } finally {
        reader.close();
      }
    },
  );

  it("cancels both pending retries when closed after a stream ends", async () => {
    vi.useFakeTimers();
    const fake = createFetchFake();
    const end = gate();
    fake.json("GET", HISTORY, 503, unavailable);
    // Keep a resume cursor so ending the stream does not reset and cancel the history retry.
    fake.stream("GET", STREAM, [control("ping"), frame(taskBegin(), "ep-1"), end.promise]);
    const reader = new SessionReader(
      new HttpTransport({ baseUrl: BASE_URL, fetch: fake.fetch }),
      SID,
    );
    try {
      await vi.advanceTimersByTimeAsync(100);
      end.open();
      await vi.advanceTimersByTimeAsync(0);
      reader.close();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fake.calls.map((c) => c.path)).toEqual([STREAM, HISTORY]);
    } finally {
      reader.close();
    }
  });

  it("discards the old history retry when the watchdog starts a fresh connection", async () => {
    vi.useFakeTimers();
    const fake = createFetchFake();
    fake.json("GET", HISTORY, 503, unavailable);
    fake.json("GET", HISTORY, 503, unavailable);
    fake.json("GET", HISTORY, 200, { messages: [] });
    fake.stream("GET", STREAM, [control("ping"), never()], { abortErrorsBody: true });
    // No ping on this connection: it has not advertised a heartbeat to watch.
    fake.stream("GET", STREAM, [frame(taskBegin(), "ep-1"), never()]);
    const reader = new SessionReader(
      new HttpTransport({ baseUrl: BASE_URL, fetch: fake.fetch }),
      SID,
      {
        reconnectMs: 60_000,
      },
    );
    try {
      await vi.advanceTimersByTimeAsync(50_000);
      expect(fake.calls.filter((c) => c.path === STREAM)).toHaveLength(2);
      expect(fake.calls.filter((c) => c.path === HISTORY)).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(fake.calls.filter((c) => c.path === HISTORY)).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.calls.filter((c) => c.path === HISTORY)).toHaveLength(3);
    } finally {
      reader.close();
    }
  });

  it.each([200, 403])(
    "ignores a stale %i history response after a fresh connection starts",
    async (status) => {
      vi.useFakeTimers();
      const fake = createFetchFake();
      const stale = gate();
      const end = gate();
      const current = assistantText("current");
      fake.json(
        "GET",
        HISTORY,
        status,
        status === 200 ? { messages: [assistantText("stale")] } : unavailable,
        stale.promise,
      );
      fake.json("GET", HISTORY, 503, unavailable);
      fake.json("GET", HISTORY, 200, { messages: [current] });
      fake.stream("GET", STREAM, [control("ping"), end.promise]);
      fake.stream("GET", STREAM, [control("ping"), never()]);
      const reader = new SessionReader(
        new HttpTransport({ baseUrl: BASE_URL, fetch: fake.fetch }),
        SID,
      );
      const seen: ReaderEvent[] = [];
      const errors: unknown[] = [];
      reader.on("event", (event) => seen.push(event));
      reader.on("error", (error) => errors.push(error));
      try {
        await vi.advanceTimersByTimeAsync(0);
        end.open();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fake.calls.filter((c) => c.path === HISTORY)).toHaveLength(2);
        stale.open();
        await vi.advanceTimersByTimeAsync(999);
        expect(seen).toEqual([]);
        expect(errors).toEqual([]);
        expect(fake.calls.filter((c) => c.path === HISTORY)).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(seen.map((event) => event.record)).toEqual([current]);
        expect(errors).toEqual([]);
        expect(fake.calls.filter((c) => c.path === HISTORY)).toHaveLength(3);
        expect(fake.calls.filter((c) => c.path === STREAM)).toHaveLength(2);
      } finally {
        stale.open();
        reader.close();
      }
    },
  );
});
