import { describe, expect, it } from "vitest";
import {
  closePage,
  emptyLayout,
  placePage,
  reorderPage,
  visitPage,
  type OpenPage,
} from "../src/lib/page-layout";

const a: OpenPage = { id: "chat:a", kind: "session", title: "A", path: "/chat/a" };
const b: OpenPage = { id: "chat:b", kind: "session", title: "B", path: "/chat/b" };
const x: OpenPage = { id: "app:x", kind: "window", title: "X", path: "/apps?app=x" };
const y: OpenPage = { id: "app:y", kind: "window", title: "Y", path: "/apps?app=y" };

describe("the open pages in a browser window", () => {
  it("opens links beside the focused session and returns to the same app from either pane", () => {
    let state = placePage(visitPage(emptyLayout, a), x, 1);
    state = visitPage(state, y);
    expect(state.visible).toEqual([a.id, y.id]);
    state = visitPage(visitPage(state, a), x);
    expect(state.visible).toEqual([a.id, x.id]);
    expect(state.focus).toBe(x.id);
    expect(state.pages.map((page) => page.id)).toEqual([a.id, x.id, y.id]);
    expect(visitPage(state, x)).toBe(state);
  });
  it("can compare two sessions, swap them and reorder the open list without changing the view", () => {
    let state = placePage(visitPage(emptyLayout, a), b, 1);
    state = placePage(state, b, 0);
    expect(state.visible).toEqual([b.id, a.id]);
    const next = reorderPage(state, b.id, a.id);
    expect(next.pages.map((page) => page.id)).toEqual([b.id, a.id]);
    expect(next.visible).toEqual(state.visible);
  });
  it("closing a pane selects its next tab before expanding the other side", () => {
    let state = visitPage(placePage(visitPage(emptyLayout, a), x, 1), y);
    state = closePage(state, y.id);
    expect(state.visible).toEqual([a.id, x.id]);
    expect(state.focus).toBe(x.id);
    state = closePage(state, x.id);
    expect(state.visible).toEqual([a.id]);
    expect(state.focus).toBe(a.id);
    expect(closePage(state, a.id)).toEqual(emptyLayout);
  });
  it("updates an inner address and title without adding another copy or moving its pane", () => {
    const state = placePage(visitPage(emptyLayout, a), x, 1);
    const moved = { ...x, title: "Report", path: "/apps?app=x&at=detail" };
    const next = visitPage(state, moved);
    expect(next.pages).toEqual([a, moved]);
    expect(next.visible).toEqual(state.visible);
  });
});
