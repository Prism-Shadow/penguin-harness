import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  closePage,
  emptyLayout,
  reorderPage,
  visitPage,
  type OpenPage,
} from "../src/lib/page-layout";

const a: OpenPage = { id: "chat:a", kind: "session", title: "A", path: "/chat/a" };
const b: OpenPage = { id: "chat:b", kind: "session", title: "B", path: "/chat/b" };
const x: OpenPage = { id: "app:x", kind: "window", title: "X", path: "/apps?app=x" };
const y: OpenPage = { id: "app:y", kind: "window", title: "Y", path: "/apps?app=y" };

describe("the open pages in a browser window", () => {
  it("opens each global destination alone after leaving a Session dock", () => {
    const open = visitPage(visitPage(emptyLayout, a), x);
    const dock = { ...open, visible: [a.id, x.id], focus: x.id };
    for (const page of [a, x, y, b]) {
      const next = visitPage(dock, page);
      expect(next.visible).toEqual([page.id]);
      expect(next.focus).toBe(page.id);
      expect(visitPage(next, page)).toBe(next);
    }
    const switched = visitPage(visitPage(dock, y), x);
    expect(switched.pages).toEqual([a, x, y]);
    expect(switched.visible).toEqual([x.id]);
  });
  it("reorders open pages without changing the visible one", () => {
    const state = visitPage(visitPage(emptyLayout, a), b);
    const next = reorderPage(state, b.id, a.id);
    expect(next.pages).toEqual([b, a]);
    expect(next.visible).toEqual([b.id]);
  });
  it("closing the active page chooses a visible neighbor and excludes minimized pages", () => {
    let state = visitPage(visitPage(visitPage(emptyLayout, a), x), y);
    state = closePage({ ...state, minimized: [x.id] }, y.id);
    expect(state.focus).toBe(a.id);
    expect(state.visible).toEqual([a.id]);
    expect(closePage(closePage(state, x.id), a.id)).toEqual(emptyLayout);
  });
  it("updates an app's inner address and title without reopening it", () => {
    const state = visitPage(visitPage(emptyLayout, a), x);
    const moved = { ...x, title: "Report", path: "/apps?app=x&at=detail" };
    const next = visitPage(state, moved);
    expect(next.pages).toEqual([a, moved]);
    expect(next.visible).toEqual([x.id]);
  });
});

describe("the page workspace context module", () => {
  // A second evaluation of the module mints a second context, and a consumer holding the first
  // reads null under a mounted provider. The dev server evaluates a module again when anything
  // it imports at runtime is edited, so this one may import only react.
  it("imports nothing at runtime but react", () => {
    const source = readFileSync(
      new URL("../src/lib/page-workspace-context.ts", import.meta.url),
      "utf8",
    );
    const runtime = [...source.matchAll(/^(?:import|export)\s(?!type\s)[^;]*?from\s+"([^"]+)"/gm)];
    expect(runtime.map((match) => match[1])).toEqual(["react"]);
    expect(source).not.toMatch(/\bimport\s*\(|^import\s+"/m);
  });
});
