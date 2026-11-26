// @vitest-environment jsdom
/**
 * The browser panel's first tab (plugins/browser-automation/src/web/use-auto-first-tab.ts): it
 * opens one by itself when the panel comes on screen with none, like the terminal's first shell.
 *
 * - Offered while shown: exactly one open, however often the panel re-renders.
 * - Not offered (tabs exist, browser unavailable): none.
 * - Hiding the panel, or showing another conversation, re-arms it; the last tab closing under a
 *   panel that stays on screen does not open another.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { useAutoFirstTab } from "../../../plugins/browser-automation/src/web/use-auto-first-tab";
import { mount, unmountAll } from "./helpers/dom";

interface Props {
  offered: boolean;
  shown: boolean;
  scope: string;
  open: () => void;
}
function Probe(props: Props) {
  useAutoFirstTab(props.offered, props.shown, props.scope, props.open);
  return null;
}

afterEach(() => unmountAll());

describe("the browser panel's first tab", () => {
  it("opens exactly one tab when shown with none, across re-renders", async () => {
    const open = vi.fn();
    const base = { offered: true, shown: true, scope: "a", open };
    const view = await mount(h(Probe, base));
    await view.rerender(h(Probe, { ...base }));
    await view.rerender(h(Probe, { ...base, open: () => open() }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens none when a tab exists or the browser is unavailable", async () => {
    const open = vi.fn();
    await mount(h(Probe, { offered: false, shown: true, scope: "a", open }));
    expect(open).not.toHaveBeenCalled();
  });

  it("opens none while the panel is hidden", async () => {
    const open = vi.fn();
    await mount(h(Probe, { offered: true, shown: false, scope: "a", open }));
    expect(open).not.toHaveBeenCalled();
  });

  it("does not open another when the last tab closes, but does on reopening or switching", async () => {
    const open = vi.fn();
    const base = { shown: true, scope: "a", open };
    const view = await mount(h(Probe, { ...base, offered: true }));
    await view.rerender(h(Probe, { ...base, offered: false })); // the tab appeared
    await view.rerender(h(Probe, { ...base, offered: true })); // ...and was closed
    expect(open).toHaveBeenCalledTimes(1);
    await view.rerender(h(Probe, { ...base, offered: true, shown: false }));
    await view.rerender(h(Probe, { ...base, offered: true }));
    expect(open).toHaveBeenCalledTimes(2);
    await view.rerender(h(Probe, { ...base, offered: true, scope: "b" }));
    expect(open).toHaveBeenCalledTimes(3);
  });
});
