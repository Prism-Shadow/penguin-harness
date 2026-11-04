/**
 * The web side of the widget slot (lib/widgets.ts): which entries of GET /api/contributions'
 * `widgets` this build can draw — the validation only, since the dock itself is part of the
 * app layout and needs a browser to mean anything.
 */
import { describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";
import { widgetsOf, widgetStore } from "../src/lib/widgets";

const iframeWidget = {
  id: "pet.widget",
  from: "AcmePet",
  key: "pet",
  title: "Pet",
  titleZh: "宠物",
  size: "small",
  renderer: { iframe: { src: "/api/plugins/@acme/pet/ui/widget.html", namespace: "pet" } },
};

describe("widgetsOf", () => {
  it("keeps a well-formed iframe widget", () => {
    expect(widgetsOf({ widgets: [iframeWidget] })).toEqual([iframeWidget]);
  });

  it("reads empty for a shapeless answer", () => {
    expect(widgetsOf(null)).toEqual([]);
    expect(widgetsOf({})).toEqual([]);
    expect(widgetsOf({ widgets: "no" })).toEqual([]);
  });

  it("skips an entry with no key or an empty one", () => {
    const entries = [
      { ...iframeWidget, key: undefined },
      { ...iframeWidget, id: "b", key: "" },
    ];
    expect(widgetsOf({ widgets: entries })).toEqual([]);
  });

  it("skips an entry whose renderer has no iframe src and no builtin name", () => {
    expect(
      widgetsOf({ widgets: [{ ...iframeWidget, renderer: { iframe: {} } }] }),
    ).toEqual([]);
    expect(widgetsOf({ widgets: [{ ...iframeWidget, renderer: {} }] })).toEqual([]);
  });

  it("keeps a builtin name when no registry is given, drops it when the registry lacks it", () => {
    const entries = [
      { id: "a", key: "a", renderer: { builtin: "clock" } },
      { id: "b", key: "b", renderer: { builtin: "weather" } },
    ];
    expect(widgetsOf({ widgets: entries })).toHaveLength(2);
    const registry = new Map<string, ComponentType>([["clock", () => null]]);
    expect(widgetsOf({ widgets: entries }, registry)).toEqual([entries[0]]);
  });

  it("keeps the first entry of a duplicated key", () => {
    const entries = [
      iframeWidget,
      { ...iframeWidget, id: "pet.widget-2", title: "Another" },
    ];
    const kept = widgetsOf({ widgets: entries });
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe("pet.widget");
  });

  it("reads a missing size as small and keeps wide as written", () => {
    const wide = { ...iframeWidget, id: "w", key: "w", size: "wide" };
    expect(widgetsOf({ widgets: [iframeWidget, wide] }).map((w) => w.size)).toEqual([
      "small",
      "wide",
    ]);
  });
});

describe("widgetStore", () => {
  it("fetches once, shares the answer, and refresh asks again", async () => {
    vi.resetModules();
    const endpoints = await import("../src/api/endpoints");
    const getContributions = vi
      .spyOn(endpoints, "getContributions")
      .mockResolvedValueOnce({ widgets: [iframeWidget] })
      .mockResolvedValueOnce({ widgets: [] });
    const store = widgetStore();
    await store.refresh();
    expect(store.current()).toEqual([iframeWidget]);
    const seen: Array<unknown> = [];
    const stop = store.subscribe(() => seen.push(store.current()));
    await store.refresh();
    expect(store.current()).toEqual([]);
    expect(seen).toEqual([[]]);
    stop();
    expect(getContributions).toHaveBeenCalledTimes(2);
  });

  it("a failed fetch reads as no widgets, and does not throw to the reader", async () => {
    vi.resetModules();
    const endpoints = await import("../src/api/endpoints");
    vi.spyOn(endpoints, "getContributions").mockRejectedValue(new Error("offline"));
    const store = widgetStore();
    await store.refresh();
    expect(store.current()).toEqual([]);
  });
});
