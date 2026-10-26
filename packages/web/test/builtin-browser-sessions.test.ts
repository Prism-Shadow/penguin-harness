/** @vitest-environment jsdom */
/**
 * With two Sessions open, switching the browser panel shows only the incoming Session's
 * tabs while all native guests remain the same DOM elements in the same order. A background
 * Session's open/activation cannot replace the foreground page. A draft becoming a Session
 * retains its guest, URL and Project partition. Manual opens carry their starting Session and
 * Project even if the user switches Sessions before the server answers. Draft adoption waits
 * for outstanding opens and moves only their original scope; a draft without browser pages
 * sends no adoption request (the server may not offer a built-in browser).
 * Returning pages after a failed first send restores the draft's selection and storage.
 * Leaving a Session whose docks show the browser for one whose docks do not opens no page there
 * (which would bring the panel up with it), and going back shows it again.
 */
import { act, createElement, Fragment, useSyncExternalStore } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import { BuiltinBrowserLayer } from "../src/features/builtin-browser/browser-layer";
import { BuiltinBrowserPanel } from "../src/features/builtin-browser/browser-panel";
import {
  adoptBrowserSession,
  openBrowserTab,
} from "../src/features/builtin-browser/browser-actions";
import { browserState, dispatchBrowser } from "../src/features/builtin-browser/browser-store";
import { guestKey } from "../src/features/builtin-browser/browser-state";
import {
  dockVersion,
  isTabShown,
  openPanel,
  setDockScope,
  subscribeDock,
} from "../src/features/dock/dock-state";
import { mount, unmountAll } from "./helpers/dom";
import { json, stubFetch } from "./helpers/fetch";

const partition = "persist:penguin-browser-project-" + "a".repeat(64);
const tab = (id: number, sessionId: string): BuiltinBrowserTab => ({
  id,
  sessionId,
  partition,
  title: `Page ${sessionId} ${id}`,
  url: `https://example.test/${id}`,
  loading: false,
  canGoBack: false,
  canGoForward: false,
});
function open(id: number, sessionId: string) {
  dispatchBrowser({
    type: "event",
    event: {
      type: "builtin_browser_open",
      requestId: String(id),
      sessionId,
      partition,
      url: `https://example.test/${id}`,
      activate: true,
    },
  });
  dispatchBrowser({ type: "attached", key: guestKey(String(id)), tabId: id });
}
function snapshot(tabs: BuiltinBrowserTab[], activeTabId: number) {
  dispatchBrowser({
    type: "event",
    event: { type: "builtin_browser_tabs", backend: "builtin", tabs, activeTabId },
  });
}

afterEach(async () => {
  await unmountAll();
  dispatchBrowser({ type: "supported", supported: false });
  vi.restoreAllMocks();
});

it("switches Session tabs without remounting or moving their native pages", async () => {
  const get = customElements.get.bind(customElements);
  vi.spyOn(customElements, "get").mockImplementation((name) =>
    name === "webview" ? HTMLElement : get(name),
  );
  stubFetch((request) =>
    request.path.endsWith("/status")
      ? json({
          available: true,
          backend: "builtin",
          tabs: browserState().tabs,
          activeTabId: browserState().activeTabId,
        })
      : request.path.endsWith("/settings")
        ? json({ homepage: null })
        : new Response(null, { status: 204 }),
  );
  dispatchBrowser({ type: "supported", supported: true });
  dispatchBrowser({ type: "scope", scope: "a", projectId: "p" });
  open(1, "a");
  open(2, "b");
  snapshot([tab(1, "a"), tab(2, "b")], 1);
  const rendered = await mount(
    createElement(
      Fragment,
      null,
      createElement(BuiltinBrowserLayer),
      createElement(BuiltinBrowserPanel, { active: false }),
    ),
  );
  const views = [...rendered.container.querySelectorAll("webview")];
  expect(views).toHaveLength(2);
  expect(rendered.container.textContent).toContain("Page a 1");
  expect(rendered.container.textContent).not.toContain("Page b 2");
  await act(async () => {
    dispatchBrowser({ type: "scope", scope: "b", projectId: "p" });
  });
  expect(rendered.container.textContent).toContain("Page b 2");
  expect(rendered.container.textContent).not.toContain("Page a 1");
  await act(async () => {
    open(3, "a");
    snapshot([tab(1, "a"), tab(2, "b"), tab(3, "a")], 3);
  });
  expect(rendered.container.textContent).toContain("Page b 2");
  expect(rendered.container.textContent).not.toContain("Page a 3");
  const all = [...rendered.container.querySelectorAll("webview")];
  expect(all.slice(0, 2)).toEqual(views);
  await act(async () => {
    dispatchBrowser({
      type: "event",
      event: { type: "builtin_browser_session", fromSessionId: "b", sessionId: "saved-b" },
    });
    dispatchBrowser({ type: "scope", scope: "saved-b", projectId: "p" });
  });
  expect([...rendered.container.querySelectorAll("webview")]).toEqual(all);
  expect(all[1]?.getAttribute("partition")).toBe(partition);
  expect(all[1]?.getAttribute("src")).toBe("https://example.test/2");
  await act(async () => {
    dispatchBrowser({ type: "scope", scope: null });
  });
  expect(rendered.container.textContent).not.toContain("Page a");
  expect(rendered.container.textContent).not.toContain("Page b");
  expect([...rendered.container.querySelectorAll("webview")]).toEqual(all);
});

it("keeps a manual open attached to its starting Session and Project", async () => {
  let answer!: (response: Response) => void;
  const wire = stubFetch(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  dispatchBrowser({ type: "supported", supported: true });
  dispatchBrowser({ type: "scope", scope: "a", projectId: "project-a" });
  const pending = openBrowserTab("https://example.test");
  dispatchBrowser({ type: "scope", scope: "b", projectId: "project-b" });
  expect(wire.requests[0]?.body).toMatchObject({ sessionId: "a", projectId: "project-a" });
  answer(json({ tab: tab(1, "a") }));
  await pending;
  expect(browserState().scope).toBe("b");
  expect(browserState().openingByScope.a).toBe(0);
});

it("waits for a draft's outstanding open before adopting it, despite a foreground switch", async () => {
  let answer!: (response: Response) => void;
  const wire = stubFetch((request) =>
    request.path.endsWith("/tabs")
      ? new Promise((resolve) => {
          answer = resolve;
        })
      : new Response(null, { status: 204 }),
  );
  dispatchBrowser({ type: "supported", supported: true });
  dispatchBrowser({ type: "scope", scope: "draft", projectId: "p" });
  const pending = openBrowserTab();
  const adoption = adoptBrowserSession("draft", "saved");
  dispatchBrowser({ type: "scope", scope: "other", projectId: "q" });
  expect(wire.requests).toHaveLength(1);
  answer(json({ tab: tab(10, "draft") }));
  await pending;
  await adoption;
  expect(wire.requests[1]?.body).toEqual({ fromSessionId: "draft", sessionId: "saved" });
  expect(browserState().scope).toBe("other");
});

it("does not require browser support from the server to send a draft without pages", async () => {
  const wire = stubFetch();
  dispatchBrowser({ type: "supported", supported: true });
  await adoptBrowserSession("empty-draft", "saved");
  expect(wire.requests).toHaveLength(0);
});

it("returns the first send's pages to the draft without reloading or changing storage", async () => {
  const wire = stubFetch(() => new Response(null, { status: 204 }));
  dispatchBrowser({ type: "supported", supported: true });
  dispatchBrowser({ type: "scope", scope: "draft", projectId: "p" });
  open(20, "draft");
  snapshot([tab(20, "draft")], 20);
  const original = browserState().guests[0];
  await adoptBrowserSession("draft", "saved");
  expect(browserState().tabs[0]?.sessionId).toBe("saved");
  await adoptBrowserSession("saved", "draft");
  expect(wire.requests.map((request) => request.body)).toEqual([
    { fromSessionId: "draft", sessionId: "saved" },
    { fromSessionId: "saved", sessionId: "draft" },
  ]);
  expect(browserState().scope).toBe("draft");
  expect(browserState().tabs[0]?.sessionId).toBe("draft");
  expect(browserState().activeByScope.draft).toBe(20);
  expect(browserState().guests[0]).toEqual(original);
});

it("opens no page in the Session switched to when the one left showed the browser", async () => {
  const get = customElements.get.bind(customElements);
  vi.spyOn(customElements, "get").mockImplementation((name) =>
    name === "webview" ? HTMLElement : get(name),
  );
  const wire = stubFetch((request) =>
    request.path.endsWith("/status")
      ? json({ available: true, backend: "builtin", tabs: [], activeTabId: null })
      : request.path.endsWith("/settings")
        ? json({ homepage: null })
        : new Response(null, { status: 204 }),
  );
  dispatchBrowser({ type: "supported", supported: true });
  dispatchBrowser({ type: "scope", scope: "shown", projectId: "p" });
  setDockScope("shown");
  openPanel("builtin-browser");
  open(30, "shown");
  snapshot([tab(30, "shown")], 30);
  // The chat page's docks, reduced to the one panel: rendered while the arrangement shows it.
  function Docks() {
    useSyncExternalStore(subscribeDock, dockVersion);
    return isTabShown("builtin-browser")
      ? createElement(BuiltinBrowserPanel, { active: true })
      : null;
  }
  await mount(
    createElement(Fragment, null, createElement(BuiltinBrowserLayer), createElement(Docks)),
  );
  // AppLayout moves both stores together when the route names another Session; the panel leaves
  // with the outgoing arrangement in the render that follows.
  await act(async () => {
    dispatchBrowser({ type: "scope", scope: "other", projectId: "p" });
    setDockScope("other");
  });
  const opens = wire.requests.filter((r) => r.method === "POST" && r.path.endsWith("/tabs"));
  expect(opens).toEqual([]);
  expect(isTabShown("builtin-browser")).toBe(false);
  await act(async () => {
    dispatchBrowser({ type: "scope", scope: "shown", projectId: "p" });
    setDockScope("shown");
  });
  expect(isTabShown("builtin-browser")).toBe(true);
  await act(async () => {
    setDockScope(null);
  });
});
