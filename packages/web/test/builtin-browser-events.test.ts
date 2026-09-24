/**
 * The built-in browser's user-channel events, as the one `/api/events` connection routes them
 * (state/sessions.tsx's applyUserEvent → features/builtin-browser/browser-events.ts): this
 * server's go to the browser layer, a machine's go nowhere — its server drives no shell on
 * this screen — and a resync tells the layer to re-read the registry.
 */
import { describe, expect, it } from "vitest";
import type { BuiltinBrowserServerEvent, ServerEvent } from "@prismshadow/penguin-server/api";
import { applyUserEvent, createSessionsStore } from "../src/state/sessions";
import {
  isBuiltinBrowserEvent,
  subscribeBuiltinBrowserEvents,
  subscribeBuiltinBrowserResync,
} from "../src/features/builtin-browser/browser-events";

const EVENTS: BuiltinBrowserServerEvent[] = [
  { type: "builtin_browser_tabs", tabs: [], activeTabId: null },
  { type: "builtin_browser_open", requestId: "r", url: "https://example.com/", activate: true },
  { type: "builtin_browser_close", tabId: 1 },
  { type: "builtin_browser_activity", tabId: 1, busy: true, action: "scan" },
];

function listStore() {
  const store = createSessionsStore();
  // Nothing here may fetch: a resync's list reload is not what these tests are about.
  store.setState({ reload: async () => undefined });
  return store;
}

describe("built-in browser events on the user channel", () => {
  it("recognises exactly the four browser events", () => {
    for (const ev of EVENTS) expect(isBuiltinBrowserEvent(ev)).toBe(true);
    const other: ServerEvent = { type: "resync_required" };
    expect(isBuiltinBrowserEvent(other)).toBe(false);
  });

  it("hands this server's browser events to the layer", () => {
    const seen: BuiltinBrowserServerEvent[] = [];
    const stop = subscribeBuiltinBrowserEvents((ev) => seen.push(ev));
    try {
      for (const ev of EVENTS) applyUserEvent(listStore(), ev, () => undefined);
    } finally {
      stop();
    }
    expect(seen).toEqual(EVENTS);
  });

  it("ignores a machine's browser events", () => {
    const seen: BuiltinBrowserServerEvent[] = [];
    const stop = subscribeBuiltinBrowserEvents((ev) => seen.push(ev));
    try {
      for (const ev of EVENTS) applyUserEvent(listStore(), ev, () => undefined, "machine-1");
    } finally {
      stop();
    }
    expect(seen).toEqual([]);
  });

  it("tells the layer to re-read the registry on this server's resync only", () => {
    let resyncs = 0;
    const stop = subscribeBuiltinBrowserResync(() => {
      resyncs += 1;
    });
    try {
      applyUserEvent(listStore(), { type: "resync_required" }, () => undefined);
      applyUserEvent(listStore(), { type: "resync_required" }, () => undefined, "machine-1");
    } finally {
      stop();
    }
    expect(resyncs).toBe(1);
  });
});
