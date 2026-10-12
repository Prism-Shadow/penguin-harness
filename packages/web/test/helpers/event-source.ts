/**
 * The browser's `EventSource` and the page's visibility, for the node suite. The test plays
 * the server through `emit` and `fail`; as in the browser, an event without an id keeps the
 * source's last event id, and a closed source never dispatches again. The package config
 * sets `unstubGlobals`, so both stubs are gone before the next test.
 */
import { vi } from "vitest";

export class FakeEventSource {
  static readonly CLOSED = 2;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, (e: MessageEvent<string>) => void>();
  private lastEventId = "";

  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (e: MessageEvent<string>) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
  /** One frame from the server: `message` is an unnamed one. */
  emit(type: string, data = "{}", id?: string): void {
    if (this.readyState === FakeEventSource.CLOSED) return;
    if (id !== undefined) this.lastEventId = id;
    const e = new MessageEvent(type, { data, lastEventId: this.lastEventId });
    if (type === "message") this.onmessage?.(e);
    else this.listeners.get(type)?.(e);
  }
  /** The browser gives up on the connection (a non-200 answer): closed, `error` fired. */
  fail(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

/** Installs the fake; returns every source constructed, oldest first. */
export function stubEventSource(): FakeEventSource[] {
  const sources: FakeEventSource[] = [];
  vi.stubGlobal(
    "EventSource",
    class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        sources.push(this);
      }
    },
  );
  return sources;
}

/** Installs a `document` whose visibility the test sets, firing `visibilitychange`. */
export function stubVisibility(): (state: DocumentVisibilityState) => void {
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", doc);
  return (state) => {
    doc.visibilityState = state;
    doc.dispatchEvent(new Event("visibilitychange"));
  };
}
