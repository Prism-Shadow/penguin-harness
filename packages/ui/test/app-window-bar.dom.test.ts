// @vitest-environment jsdom
/**
 * AppWindowBar (src/components/shell/app-window/app-window-bar.tsx) on a real page
 * (test/helpers/dom.ts): an app window's title bar.
 *
 * - Given every handler, the bar is headed by the app's name and its controls read minimize, full
 *   screen, close, in that order; each press tells the caller which one it was, and only that.
 * - Given only a close, the window offers close alone: no control stands for what it cannot do.
 * - Given controls of the app's own, they come after the name and before the window's.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { AppWindowBar } from "../src/components/shell/app-window/app-window-bar";
import { fire, mount, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

const LABELS = { minimize: "Minimize", fullScreen: "Open full screen", close: "Close" };

const controls = () =>
  [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
const press = (name: string) =>
  fire(
    document.querySelector(`button[aria-label="${name}"]`)!,
    new MouseEvent("click", { bubbles: true }),
  );

describe("AppWindowBar", () => {
  it("names the app, then offers minimize, full screen and close in that order", async () => {
    const onMinimize = vi.fn();
    const onFullScreen = vi.fn();
    const onClose = vi.fn();
    await mount(
      h(AppWindowBar, { title: "Daily to-dos", labels: LABELS, onMinimize, onFullScreen, onClose }),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Daily to-dos");
    expect(controls()).toEqual(["Minimize", "Open full screen", "Close"]);

    await press("Minimize");
    expect([onMinimize.mock.calls.length, onFullScreen.mock.calls.length]).toEqual([1, 0]);
    await press("Open full screen");
    expect(onFullScreen).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    await press("Close");
    expect([onMinimize, onFullScreen, onClose].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("offers close alone to a window that can neither minimize nor go full screen", async () => {
    await mount(h(AppWindowBar, { title: "Daily to-dos", labels: LABELS, onClose: () => {} }));
    expect(controls()).toEqual(["Close"]);
  });

  it("puts the app's own controls between its name and the window's", async () => {
    await mount(
      h(AppWindowBar, {
        title: "Daily to-dos",
        labels: LABELS,
        controls: h("button", { type: "button", "aria-label": "Board page" }),
        onMinimize: () => {},
        onClose: () => {},
      }),
    );
    expect(controls()).toEqual(["Board page", "Minimize", "Close"]);
  });
});
