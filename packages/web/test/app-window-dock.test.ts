/** @vitest-environment jsdom */
/**
 * A window that holds a dock, hidden behind another window of its stack and shown again
 * (`WindowStack`, `AppWindow` from the UI package): the chat page's window holds the docks.
 *
 * - Given a window with a dock open and text typed in its panel, when another window is shown
 *   over it, then the window — the dock inside it — is neither painted nor reachable (hidden,
 *   inert), and the other window is; nothing in it was unmounted, and the dock kept its size.
 * - When the window is shown again, the same dock element is back at the same size with the same
 *   text, and the other window is gone.
 * - Given the built-in browser's panel shown in that dock, its page leaves the slot while the
 *   window is hidden (it is laid over the slot from outside the window, so hiding the window does
 *   not hide it) and comes back with the window.
 */
import { createElement as h, useState } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuiltinBrowserStatus } from "@prismshadow/penguin-server/api";
import { AppWindow, DockFrame, WindowStack } from "@prismshadow/penguin-ui";
// The browser reaches the app's own helpers through the plugin face; this hands them over.
import "../src/web-app/plugin-host";
import { BuiltinBrowserPanel } from "../../../plugins/browser-automation/src/web/browser-panel";
import { dispatchBrowser } from "../../../plugins/browser-automation/src/web/browser-store";
import { hasVisibleSlot } from "../../../plugins/browser-automation/src/web/slot-registry";
import { LocaleProvider } from "../src/state/locale";
import { button, click, mount, type, unmountAll } from "./helpers/dom";

/** A stack of two windows, the first holding a dock with a panel body of the test's own. */
function Page({ body }: { body: ReactNode }) {
  const [other, setOther] = useState(false);
  return h(
    LocaleProvider,
    null,
    h("button", { type: "button", onClick: () => setOther((v) => !v) }, "Switch windows"),
    h(
      WindowStack,
      null,
      h(
        AppWindow,
        { shown: !other, id: "chat-window" },
        h(DockFrame, {
          position: "right",
          open: true,
          size: 360,
          contentSize: 360,
          animate: false,
          tabs: "Files",
          actions: null,
          children: body,
        }),
      ),
      other && h(AppWindow, { shown: true, id: "other-window" }, h("iframe", null)),
    ),
  );
}

const switchWindows = () => click(button("Switch windows"));
const chatWindow = () => document.getElementById("chat-window")!;
const dock = () => document.querySelector<HTMLElement>('[data-testid="dock"]')!;

afterEach(unmountAll);

describe("a window shown over the window that holds the docks", () => {
  it("hides Chat and its dock without unmounting them, and shows them back as they were", async () => {
    await mount(h(Page, { body: h("textarea", { "aria-label": "Draft" }) }));
    const dockBefore = dock();
    const draft = document.querySelector("textarea")!;
    await type(draft, "half a thought");

    await switchWindows();

    expect(chatWindow().hasAttribute("inert")).toBe(true);
    expect(chatWindow().classList.contains("invisible")).toBe(true);
    expect(chatWindow().contains(dockBefore)).toBe(true);
    const shown = document.getElementById("other-window")!;
    expect(shown.hasAttribute("inert")).toBe(false);
    expect(shown.classList.contains("invisible")).toBe(false);

    await switchWindows();

    expect(chatWindow().hasAttribute("inert")).toBe(false);
    expect(chatWindow().classList.contains("invisible")).toBe(false);
    expect(dock()).toBe(dockBefore);
    expect(dock().style.width).toBe("360px");
    expect(document.querySelector("textarea")).toBe(draft);
    expect(draft.value).toBe("half a thought");
    expect(document.getElementById("other-window")).toBeNull();
  });
});

describe("the built-in browser's page", () => {
  beforeEach(() => {
    // A window that can host the built-in browser (the desktop shell defines `<webview>`, a
    // name no page may register), and a server that drives it.
    const get = customElements.get.bind(customElements);
    vi.spyOn(customElements, "get").mockImplementation((name) =>
      name === "webview" ? HTMLElement : get(name),
    );
    dispatchBrowser({ type: "supported", supported: true });
    const status: BuiltinBrowserStatus = {
      available: true,
      backend: "builtin",
      backends: [{ backend: "builtin", available: true }],
      tabs: [],
      activeTabId: null,
    };
    dispatchBrowser({ type: "status", status });
  });
  afterEach(async () => {
    await unmountAll();
    dispatchBrowser({ type: "supported", supported: false });
    vi.restoreAllMocks();
  });

  it("leaves its slot while its window is hidden, and comes back with it", async () => {
    await mount(h(Page, { body: h(BuiltinBrowserPanel, { active: true }) }));
    expect(hasVisibleSlot()).toBe(true);

    await switchWindows();
    expect(hasVisibleSlot()).toBe(false);

    await switchWindows();
    expect(hasVisibleSlot()).toBe(true);
  });
});
