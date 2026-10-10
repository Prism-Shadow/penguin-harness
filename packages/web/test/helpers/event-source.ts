/**
 * The browser's `EventSource`, and the page events that decide when a stream is checked
 * (`visibilitychange`, `online`), for the node suite: the package's one fake of each.
 *
 * The fake keeps the browser's contract, failure branches included, because those are what
 * the stream wrapper is written against:
 *
 * - `open()` fires `open` and moves to OPEN; `drop()` is a network error, after which the
 *   browser itself reconnects (CONNECTING, `error` fired); `fail()` is the browser giving up
 *   for good (a non-200 answer: CLOSED, `error` fired, nothing more ever).
 * - An event's `lastEventId` is the source's last-event-id buffer: set by an event that
 *   carries an id, kept by one that does not (a heartbeat), exactly as the browser does.
 * - A closed source dispatches nothing. Driving one is a test bug, so it throws.
 *
 * The package config sets `unstubGlobals`, so both stubs are gone before the next test.
 */
import { vi } from "vitest";

export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readyState: number = FakeEventSource.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private readonly listeners = new Map<string, Set<(e: MessageEvent<string>) => void>>();
  private lastEventIdBuffer = "";

  constructor(url: string | URL) {
    this.url = String(url);
  }

  addEventListener(type: string, listener: (e: MessageEvent<string>) => void): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
  }

  removeEventListener(type: string, listener: (e: MessageEvent<string>) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  // ---- what the network does to it ----

  /** The response arrived: OPEN, `open` fired. */
  open(): void {
    this.assertLive();
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event("open"));
  }

  /** One SSE frame: unnamed (`message`) unless `event` is given; `id` updates the buffer. */
  frame(data: string, opts: { event?: string; id?: string } = {}): void {
    this.assertLive();
    if (opts.id !== undefined) this.lastEventIdBuffer = opts.id;
    const type = opts.event ?? "message";
    const e = new MessageEvent<string>(type, { data, lastEventId: this.lastEventIdBuffer });
    if (type === "message") this.onmessage?.(e);
    for (const listener of this.listeners.get(type) ?? []) listener(e);
  }

  /** The server's heartbeat: a named `ping` event without an id. */
  ping(): void {
    this.frame("{}", { event: "ping" });
  }

  /** A network error: the browser will reconnect on its own (CONNECTING, `error` fired). */
  drop(): void {
    this.assertLive();
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.(new Event("error"));
  }

  /** The browser gives up on this source (e.g. a 502 answer): CLOSED, `error` fired. */
  fail(): void {
    this.assertLive();
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event("error"));
  }

  private assertLive(): void {
    if (this.readyState === FakeEventSource.CLOSED) {
      throw new Error(`test drove a closed EventSource (${this.url})`);
    }
  }
}

export interface EventSourceStub {
  /** Every source the code under test constructed, oldest first. */
  readonly sources: FakeEventSource[];
  /** The newest one. */
  latest(): FakeEventSource;
  /** Sources not closed by the code under test. */
  live(): FakeEventSource[];
}

/** Installs the fake as the global `EventSource` for the current test. */
export function stubEventSource(): EventSourceStub {
  const sources: FakeEventSource[] = [];
  class Recorded extends FakeEventSource {
    constructor(url: string | URL) {
      super(url);
      sources.push(this);
    }
  }
  vi.stubGlobal("EventSource", Recorded);
  return {
    sources,
    latest: () => {
      const last = sources.at(-1);
      if (!last) throw new Error("no EventSource was constructed");
      return last;
    },
    live: () => sources.filter((s) => s.readyState !== FakeEventSource.CLOSED),
  };
}

export interface PageLifecycle {
  /** The tab is hidden, or shown again (`visibilitychange` fires). */
  setVisible(visible: boolean): void;
  /** The browser reports the network is back (`online` fires). */
  goOnline(): void;
}

/** Installs a `document` with a visibility state and a `window` that fires `online`. */
export function stubPageLifecycle(): PageLifecycle {
  const doc = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
  });
  const win = new EventTarget();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  return {
    setVisible: (visible) => {
      doc.visibilityState = visible ? "visible" : "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    goOnline: () => win.dispatchEvent(new Event("online")),
  };
}
