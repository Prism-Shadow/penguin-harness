/**
 * The agent browser's user-channel events, as the one `/api/events` connection routes them
 * (state/sessions.tsx's applyUserEvent → features/builtin-browser/browser-events.ts): this
 * every one goes to the browser layer named by the server it came from — null for this one, the
 * machine id for a machine, whose own browser the events are about — and a resync tells the
 * layer to re-read that server's registry.
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
  { type: "builtin_browser_tabs", tabs: [], activeTabId: null, backend: "builtin" },
  { type: "builtin_browser_open", requestId: "r", url: "https://example.com/", activate: true },
  { type: "builtin_browser_close", tabId: 1 },
  { type: "builtin_browser_activity", tabId: 1, busy: true, action: "scan" },
  {
    type: "builtin_browser_metrics",
    metrics: { at: 1, tabs: [], totalKB: 0, warnings: [], heavyTabIds: [] },
  },
  { type: "builtin_browser_backend", backend: "chrome" },
  { type: "builtin_browser_extension", state: "disconnected" },
];

function listStore() {
  const store = createSessionsStore();
  // Nothing here may fetch: a resync's list reload is not what these tests are about.
  store.setState({ reload: async () => undefined });
  return store;
}

describe("agent browser events on the user channel", () => {
  it("recognises exactly the seven browser events", () => {
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

  it("names this server as the source of its own events", () => {
    const sources: (string | null)[] = [];
    const stop = subscribeBuiltinBrowserEvents((_ev, server) => sources.push(server));
    try {
      for (const ev of EVENTS) applyUserEvent(listStore(), ev, () => undefined);
    } finally {
      stop();
    }
    expect(sources).toEqual(EVENTS.map(() => null));
  });

  it("hands a machine's browser events to the layer, named by the machine", () => {
    const seen: [BuiltinBrowserServerEvent, string | null][] = [];
    const stop = subscribeBuiltinBrowserEvents((ev, server) => seen.push([ev, server]));
    try {
      for (const ev of EVENTS) applyUserEvent(listStore(), ev, () => undefined, "machine-1");
    } finally {
      stop();
    }
    expect(seen).toEqual(EVENTS.map((ev) => [ev, "machine-1"]));
  });

  it("tells the layer which server's registry to re-read on a resync", () => {
    const resyncs: (string | null)[] = [];
    const stop = subscribeBuiltinBrowserResync((server) => resyncs.push(server));
    try {
      applyUserEvent(listStore(), { type: "resync_required" }, () => undefined);
      applyUserEvent(listStore(), { type: "resync_required" }, () => undefined, "machine-1");
    } finally {
      stop();
    }
    expect(resyncs).toEqual([null, "machine-1"]);
  });
});
