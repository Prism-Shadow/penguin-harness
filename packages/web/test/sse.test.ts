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
import { afterEach, describe, expect, it, vi } from "vitest";
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

// A `resync_required` is the server telling us it could not resume from the id we offered —
// its channel buffer lost those events, or it belongs to a different channel epoch (the
// server restarted, or recycled the Session). Keeping that id would make the NEXT reconnect
// offer the same unusable id and be refused again, each refusal costing a full rebuild, so
// the connection could never get past it. Dropping it makes the reconnect a fresh
// subscription, which the server grants by definition.
describe("after a resync_required", () => {
  it("reopens WITHOUT the id the server just refused", () => {
    const { sources } = subscribe();
    greet(sources[0]!, "e-1");
    sources[0]!.emit("message", "{}", "e-2");
    // The server refuses that id.
    sources[0]!.emit("server_event", JSON.stringify({ type: "resync_required" }), "e-3");
    sources[0]!.emit("ping");
    vi.advanceTimersByTime(50_000);
    // No ?lastEventId= — a bare URL, i.e. a fresh subscription.
    expect(sources[1]!.url).toBe("/api/sessions/s1/stream");
  });

  it("records no id until a new connection exists, then resumes normally from there", () => {
    const { sources } = subscribe();
    greet(sources[0]!, "e-1");
    sources[0]!.emit("server_event", JSON.stringify({ type: "resync_required" }), "e-2");
    // Events still arriving on the SAME (old) connection carry ids too — the browser keeps
    // reporting the last id it saw, and a real EventSource has no way to tell those apart
    // from the new channel's. So they are not recorded: the refusal stands until a reconnect.
    sources[0]!.emit("message", "{}", "e-9");
    sources[0]!.emit("ping");
    vi.advanceTimersByTime(50_000);
    expect(sources[1]!.url).toBe("/api/sessions/s1/stream");
    // The reconnect was granted, so from HERE ids are recorded again...
    greet(sources[1]!, "n-1");
    sources[1]!.emit("message", "{}", "n-2");
    sources[1]!.emit("ping");
    vi.advanceTimersByTime(50_000);
    // ...and the NEXT reconnect resumes from the new channel, not from the voided one.
    expect(sources[2]!.url).toBe("/api/sessions/s1/stream?lastEventId=n-2");
  });

  it("a resync with no prior id still leaves the reconnect bare", () => {
    const { sources } = subscribe();
    greet(sources[0]!, "e-1");
    sources[0]!.emit("server_event", JSON.stringify({ type: "resync_required" }), "e-2");
    sources[0]!.emit("ping");
    vi.advanceTimersByTime(50_000);
    expect(sources[1]!.url).toBe("/api/sessions/s1/stream");
  });
});
