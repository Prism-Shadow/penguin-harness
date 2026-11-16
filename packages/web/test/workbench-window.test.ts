/** @vitest-environment jsdom */
/**
 * The Chat window and a workbench tab's window share the area under the chat page's tab strip
 * (`WindowStack`, `AppWindow` from the UI package); the docks belong to Chat.
 *
 * - Given Chat with a dock open and text typed in its panel, when a workbench tab is shown, then
 *   the Chat window — the dock inside it — is neither painted nor reachable (hidden, inert), and
 *   the workbench window is; nothing in Chat was unmounted, and the dock kept its size.
 * - When Chat is shown again, the same dock element is back at the same size with the same text,
 *   and the workbench window is gone.
 * - Given the built-in browser's panel shown in that dock, its page leaves the slot while the
 *   workbench is up (it is laid over the slot from outside the window, so hiding the window does
 *   not hide it) and comes back with Chat.
 */
import { createElement as h, useState } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuiltinBrowserStatus } from "@prismshadow/penguin-server/api";
import { AppWindow, DockFrame, WindowStack } from "@prismshadow/penguin-ui";
import { WorkbenchTabStrip } from "../src/features/workbenches/workbench-tabs";
import { BuiltinBrowserPanel } from "../src/features/builtin-browser/browser-panel";
import { dispatchBrowser } from "../src/features/builtin-browser/browser-store";
import { hasVisibleSlot } from "../src/features/builtin-browser/slot-registry";
import { S } from "../src/lib/strings";
import { LocaleProvider } from "../src/state/locale";
import type { WorkbenchTab } from "../src/lib/workbench-tabs";
import { click, mount, type, unmountAll } from "./helpers/dom";

const BOARD: WorkbenchTab = {
  tabId: "demo/board",
  workbenchId: "demo",
  key: "board",
  title: "Board",
  name: "Demo",
  version: "1.0.0",
  revision: "abcdef012345",
  uiRev: "0123456789ab",
  src: "/api/projects/p/agents/a/workbenches/demo/ui/index.html",
  error: null,
  machineId: null,
};

/** The chat page's arrangement, with a panel body of the test's own in the dock. */
function Page({ body }: { body: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  return h(
    LocaleProvider,
    null,
    h(WorkbenchTabStrip, { tabs: [BOARD], active, onSelect: setActive }),
    h(
      WindowStack,
      null,
      h(
        AppWindow,
        { shown: active === null, id: "chat-window" },
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
      active !== null && h(AppWindow, { shown: true, id: "workbench-window" }, h("iframe", null)),
    ),
  );
}

const tab = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (el) => el.textContent === name,
  )!;
const chatWindow = () => document.getElementById("chat-window")!;
const dock = () => document.querySelector<HTMLElement>('[data-testid="dock"]')!;

afterEach(unmountAll);

describe("a workbench tab over the Chat window", () => {
  it("hides Chat and its dock without unmounting them, and shows them back as they were", async () => {
    await mount(h(Page, { body: h("textarea", { "aria-label": "Draft" }) }));
    const dockBefore = dock();
    const draft = document.querySelector("textarea")!;
    await type(draft, "half a thought");

    await click(tab("Board"));

    expect(chatWindow().hasAttribute("inert")).toBe(true);
    expect(chatWindow().classList.contains("invisible")).toBe(true);
    expect(chatWindow().contains(dockBefore)).toBe(true);
    const workbench = document.getElementById("workbench-window")!;
    expect(workbench.hasAttribute("inert")).toBe(false);
    expect(workbench.classList.contains("invisible")).toBe(false);

    await click(tab(S.workbenches.chatTab));

    expect(chatWindow().hasAttribute("inert")).toBe(false);
    expect(chatWindow().classList.contains("invisible")).toBe(false);
    expect(dock()).toBe(dockBefore);
    expect(dock().style.width).toBe("360px");
    expect(document.querySelector("textarea")).toBe(draft);
    expect(draft.value).toBe("half a thought");
    expect(document.getElementById("workbench-window")).toBeNull();
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

  it("leaves its slot while a workbench tab is shown, and comes back with Chat", async () => {
    await mount(h(Page, { body: h(BuiltinBrowserPanel, { active: true }) }));
    expect(hasVisibleSlot()).toBe(true);

    await click(tab("Board"));
    expect(hasVisibleSlot()).toBe(false);

    await click(tab(S.workbenches.chatTab));
    expect(hasVisibleSlot()).toBe(true);
  });
});
