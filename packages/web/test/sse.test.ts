/**
 * Stream liveness (api/sse.ts), against the browser's EventSource contract.
 *
 * - Given a stream that has pinged, when it is silent for 50 s, its EventSource is closed and
 *   one new one opens with `?lastEventId=` set to the newest id seen (at 49 s nothing
 *   happens); silent again before the new one delivered an id, it resumes from the same id.
 * - Given pings every 20 s, the stream is never reopened.
 * - Given a tab whose timers did not run, becoming visible past the window reopens the stream
 *   at once; being hidden does not.
 * - Given a server that never pings (one older than the heartbeat), nothing reopens it.
 * - Once the caller closed it, or the browser gave up on it (reported as a closed error),
 *   nothing reopens it.
 */
import { afterEach, expect, it, vi } from "vitest";
import { openSessionStream } from "../src/api/sse";
import { FakeEventSource, stubEventSource, stubVisibility } from "./helpers/event-source";

afterEach(() => {
  vi.useRealTimers();
});

function subscribe() {
  vi.useFakeTimers();
  const sources = stubEventSource();
  const setVisibility = stubVisibility();
  const errors: boolean[] = [];
  const conn = openSessionStream("s1", {
    onOmniMessage: () => undefined,
    onServerEvent: () => undefined,
    onError: (closed) => errors.push(closed),
  });
  return { sources, setVisibility, conn, errors };
}
type Sub = ReturnType<typeof subscribe>;

/** What a current server sends first: the snapshot, with an id, then a ping. */
function greet(source: FakeEventSource, id: string): void {
  source.emit("server_event", JSON.stringify({ type: "task_state", state: "running" }), id);
  source.emit("ping");
}

const live = (sources: FakeEventSource[]) =>
  sources.filter((s) => s.readyState !== FakeEventSource.CLOSED);

it("a stream silent for 50 s is reopened, once, from the newest event id seen", () => {
  const { sources } = subscribe();
  greet(sources[0]!, "e-1");
  sources[0]!.emit("message", "{}", "e-2");

  vi.advanceTimersByTime(49_000);
  expect(sources).toHaveLength(1);
  vi.advanceTimersByTime(1_000);
  expect(sources[1]!.url).toBe("/api/sessions/s1/stream?lastEventId=e-2");
  expect(live(sources)).toEqual([sources[1]]);

  sources[1]!.emit("ping");
  vi.advanceTimersByTime(50_000);
  expect(sources[2]!.url).toBe("/api/sessions/s1/stream?lastEventId=e-2");
  expect(live(sources)).toEqual([sources[2]]);
});

it("a stream that keeps pinging is never reopened", () => {
  const { sources } = subscribe();
  greet(sources[0]!, "e-1");
  for (let beat = 0; beat < 10; beat++) {
    vi.advanceTimersByTime(20_000);
    sources[0]!.emit("ping");
  }
  expect(sources).toHaveLength(1);
});

it("becoming visible past the window reopens the stream at once, though no timer ran", () => {
  const { sources, setVisibility } = subscribe();
  greet(sources[0]!, "e-1");
  vi.setSystemTime(Date.now() + 120_000);
  setVisibility("hidden");
  expect(sources).toHaveLength(1);
  setVisibility("visible");
  expect(sources[1]!.url).toBe("/api/sessions/s1/stream?lastEventId=e-1");
  expect(live(sources)).toEqual([sources[1]]);
});

it("a stream that never pinged is never reopened", () => {
  const { sources, setVisibility } = subscribe();
  sources[0]!.emit("server_event", JSON.stringify({ type: "task_state", state: "idle" }), "e-1");
  vi.advanceTimersByTime(60 * 60_000);
  setVisibility("visible");
  expect(live(sources)).toEqual([sources[0]]);
});

it.each([
  { how: "the caller closed it", end: (s: Sub) => s.conn.close(), errors: [] },
  { how: "the browser gave up on it", end: (s: Sub) => s.sources[0]!.fail(), errors: [true] },
])("once $how, a stream is never reopened", ({ end, errors }) => {
  const sub = subscribe();
  greet(sub.sources[0]!, "e-1");
  end(sub);
  vi.advanceTimersByTime(60 * 60_000);
  sub.setVisibility("visible");
  expect(live(sub.sources)).toEqual([]);
  expect(sub.errors).toEqual(errors);
});
