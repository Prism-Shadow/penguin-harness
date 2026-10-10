/**
 * Stream liveness (api/sse.ts), against the browser's EventSource contract.
 *
 * - Given a stream that has pinged, when it stays silent past 50 s, its EventSource is closed
 *   and a new one opens with `?lastEventId=` set to the newest event id seen; at 49 s nothing
 *   happens. Through a machine's proxy path too.
 * - Given pings every 20 s, the stream is never reopened, however long it runs.
 * - Given a tab whose timers did not run, becoming visible past the window reopens the stream
 *   at once, and so does the browser coming back online; within the window, or when the tab
 *   is hidden, nothing happens.
 * - Given reopens that keep failing, each waits twice as long as the one before (1 s, 2 s,
 *   4 s …, never more than 30 s); hearing from the server starts over, and the network
 *   coming back fires a waiting retry at once.
 * - Given a server that never pings (one older than the heartbeat), nothing is ever reopened:
 *   not after an hour of silence, not when the browser gives up on it, not on wake-ups.
 * - Callers hear every open, a reopen included, and every error with whether the browser
 *   gave up on the connection.
 * - At most one EventSource is open at any time; after close() none is, and no timer,
 *   visibility change or network event opens another.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSessionStream, openUserEvents } from "../src/api/sse";
import type { StreamConnection, StreamHandlers } from "../src/api/sse";
import { FakeEventSource, stubEventSource, stubPageLifecycle } from "./helpers/event-source";

afterEach(() => {
  vi.useRealTimers();
});

interface Heard {
  opens: number;
  errors: boolean[];
  /** `<type>@<event id>` for every server event, in order. */
  events: string[];
}

function subscribe(
  open: (handlers: StreamHandlers) => StreamConnection = (h) => openSessionStream("s1", h),
) {
  vi.useFakeTimers();
  const es = stubEventSource();
  const page = stubPageLifecycle();
  const heard: Heard = { opens: 0, errors: [], events: [] };
  const conn = open({
    onOmniMessage: (_msg, id) => heard.events.push(`omni@${id}`),
    onServerEvent: (ev, id) => heard.events.push(`${ev.type}@${id}`),
    onOpen: () => (heard.opens += 1),
    onError: (closed) => heard.errors.push(closed),
  });
  return { es, page, conn, heard };
}

/** What a current server sends on a new connection: the snapshot (with an id), then a ping. */
function greet(source: FakeEventSource, id: string): void {
  source.open();
  source.frame(JSON.stringify({ type: "task_state", state: "running" }), {
    event: "server_event",
    id,
  });
  source.ping();
}

describe("a stream that has pinged", () => {
  it.each([
    {
      stream: "a Session stream",
      open: (h: StreamHandlers) => openSessionStream("s1", h),
      reopened: "/api/sessions/s1/stream?lastEventId=e-3",
    },
    {
      stream: "a machine's user stream",
      open: (h: StreamHandlers) => openUserEvents(h, "m1"),
      reopened: "/server/m1/api/events?lastEventId=e-3",
    },
  ])("$stream silent past 50 s is reopened from the last event id seen", ({ open, reopened }) => {
    const { es, heard } = subscribe(open);
    const first = es.latest();
    greet(first, "e-1");
    first.frame(JSON.stringify({ type: "message" }), { id: "e-2" });
    first.frame(JSON.stringify({ type: "message" }), { id: "e-3" });
    expect(heard.events).toEqual(["task_state@e-1", "omni@e-2", "omni@e-3"]);

    vi.advanceTimersByTime(49_000);
    expect(es.sources).toHaveLength(1);

    vi.advanceTimersByTime(2_000);
    expect(first.readyState).toBe(FakeEventSource.CLOSED);
    expect(es.latest().url).toBe(reopened);
    expect(es.live()).toHaveLength(1);
  });

  it("a second reopen resumes from the newest id the reopened connection delivered", () => {
    const { es } = subscribe();
    greet(es.latest(), "e-1");
    vi.advanceTimersByTime(51_000);
    const second = es.latest();
    greet(second, "e-7");

    vi.advanceTimersByTime(51_000);
    expect(es.sources).toHaveLength(3);
    expect(es.latest().url).toBe("/api/sessions/s1/stream?lastEventId=e-7");
    expect(es.live()).toEqual([es.latest()]);
  });

  it("is never reopened while pings keep arriving", () => {
    const { es } = subscribe();
    greet(es.latest(), "e-1");
    for (let beat = 0; beat < 30; beat++) {
      vi.advanceTimersByTime(20_000);
      es.latest().ping();
    }
    expect(es.sources).toHaveLength(1);
  });

  it.each([
    {
      wake: "the tab becoming visible",
      fire: (p: ReturnType<typeof stubPageLifecycle>) => p.setVisible(true),
    },
    {
      wake: "the browser coming back online",
      fire: (p: ReturnType<typeof stubPageLifecycle>) => p.goOnline(),
    },
  ])("is checked at once on $wake, even when its timers did not run", ({ fire }) => {
    const { es, page } = subscribe();
    greet(es.latest(), "e-1");
    page.setVisible(false);

    // Within the window: nothing to do.
    vi.setSystemTime(Date.now() + 10_000);
    fire(page);
    expect(es.sources).toHaveLength(1);

    // Past it, while no timer ran (a background tab, a sleeping laptop).
    page.setVisible(false);
    vi.setSystemTime(Date.now() + 120_000);
    expect(es.sources).toHaveLength(1);
    fire(page);
    expect(es.sources).toHaveLength(2);
    expect(es.latest().url).toBe("/api/sessions/s1/stream?lastEventId=e-1");
    expect(es.live()).toHaveLength(1);
  });

  it("is reopened with a doubling backoff while reopens keep failing, and starts over once heard from", () => {
    const { es, page, heard } = subscribe();
    greet(es.latest(), "e-1");

    // The browser gives up on it (say, a 502 while the server restarts): reopened at once.
    es.latest().fail();
    expect(es.sources).toHaveLength(2);

    for (const wait of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      const before = es.sources.length;
      es.latest().fail();
      vi.advanceTimersByTime(wait - 1);
      expect(es.sources).toHaveLength(before);
      expect(es.live()).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(es.sources).toHaveLength(before + 1);
    }
    expect(heard.errors.every((closed) => closed)).toBe(true);

    // Heard from again: the next failure is retried at once.
    greet(es.latest(), "e-2");
    const before = es.sources.length;
    es.latest().fail();
    expect(es.sources).toHaveLength(before + 1);

    // A retry waiting out its backoff goes at once when the network comes back.
    es.latest().fail();
    expect(es.sources).toHaveLength(before + 1);
    page.goOnline();
    expect(es.sources).toHaveLength(before + 2);
    expect(es.latest().url).toBe("/api/sessions/s1/stream?lastEventId=e-2");
    expect(es.live()).toHaveLength(1);
  });
});

describe("a stream that has never pinged", () => {
  it("is left to the browser: not reopened after silence, a failure or a wake-up", () => {
    const { es, page, heard } = subscribe();
    const only = es.latest();
    only.open();
    only.frame(JSON.stringify({ type: "task_state", state: "idle" }), {
      event: "server_event",
      id: "e-1",
    });

    vi.advanceTimersByTime(60 * 60_000);
    page.setVisible(true);
    page.goOnline();
    expect(es.sources).toHaveLength(1);
    expect(only.readyState).toBe(FakeEventSource.OPEN);

    only.fail();
    vi.advanceTimersByTime(60 * 60_000);
    page.goOnline();
    expect(es.sources).toHaveLength(1);
    expect(heard.errors).toEqual([true]);
  });
});

describe("callers", () => {
  it("hear every open, a reopen included, and every error with whether the browser gave up", () => {
    const { es, heard } = subscribe();
    const first = es.latest();
    greet(first, "e-1");
    expect(heard.opens).toBe(1);

    // A network error the browser recovers from by itself.
    first.drop();
    expect(es.sources).toHaveLength(1);
    first.open();
    first.ping();
    expect(heard.opens).toBe(2);

    vi.advanceTimersByTime(51_000);
    expect(es.sources).toHaveLength(2);
    es.latest().open();
    expect(heard.opens).toBe(3);
    es.latest().fail();
    expect(heard.errors).toEqual([false, true]);
  });
});

describe("close()", () => {
  it("closes the open EventSource, cancels a waiting retry, and nothing opens another", () => {
    const { es, page, conn, heard } = subscribe();
    greet(es.latest(), "e-1");
    es.latest().fail();
    es.latest().fail(); // a retry now waits 1 s
    const opened = es.sources.length;

    conn.close();
    vi.advanceTimersByTime(60 * 60_000);
    page.setVisible(true);
    page.goOnline();
    expect(es.sources).toHaveLength(opened);
    expect(es.live()).toHaveLength(0);
    expect(heard.errors).toEqual([true, true]);
  });

  it("closes a healthy stream for good", () => {
    const { es, conn } = subscribe();
    greet(es.latest(), "e-1");
    conn.close();
    expect(es.latest().readyState).toBe(FakeEventSource.CLOSED);
    vi.advanceTimersByTime(60 * 60_000);
    expect(es.sources).toHaveLength(1);
  });
});
