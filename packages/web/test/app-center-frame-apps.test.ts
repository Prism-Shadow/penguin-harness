/** @vitest-environment jsdom */
/**
 * A system app a server module contributes as an iframe page (`WebModule.pages` with `app`): it
 * opens in the App Center's window like an Agent's app, keyed `system_agent/<page key>`, and its
 * page keeps its own location in the window's address (lib/page-frame.tsx, frame-app-body.tsx).
 * The fixture is a "Reports" page of a made-up module; nothing here is specific to any one app.
 *
 * - Its tile opens the window over the grid, not its page's address; minimize keeps the same frame
 *   running, its tile says so, and a click brings that frame back.
 * - Its page's address, and every address under it, lead into the window with the rest of the
 *   path and the query as `at`, replacing the history entry; the frame starts there.
 * - The page's own moves (`penguin:location`) replace `at`; an `at` the address gains on its own
 *   reaches the page as the same message, without a reload. An address naming no place inside
 *   the app (its tile, its page's own address) brings a running window back where its page is,
 *   and the address says so; once the app has ended it opens at its start.
 * - `penguin:navigate` takes the viewer to a path of this app, leaving the window minimized and
 *   running; another origin's path, the API, another frame's message and a minimized window's
 *   page are ignored.
 * - Full screen draws the same document with no window around it, at the page's place; its exit
 *   comes back to the window there.
 * - The frame's root carries the interface language and the current Project, and follows a
 *   language switch; so does a contributed iframe page that is no system app, at its own path.
 */
import { act, createElement as h } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";
import { AppCenterPage } from "../src/features/app-center/app-center-page";
import { WorkspaceWindows, pageAction } from "./helpers/workspace-windows";
import { SystemAppPage } from "../src/features/app-center/system-app-page";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { useLocale } from "../src/state/locale";
import { ThemeProvider } from "../src/state/theme";
import { pageTableFor } from "../src/web-app/contributions";
import { ShellRoutes } from "../src/web-app/router";
import { PROJECT_ID, agentServer, buttonIn, mountAgentApp, whereIs } from "./helpers/agent-app";
import { button, click, menuItem, run, settle, unmountAll, waitFor } from "./helpers/dom";
import { SYSTEM_APP_PAGES } from "./helpers/system-app-pages";

const KEY = "system_agent/reports";
const SRC = "/api/reports-app/ui/index.html";
const ORIGIN = "http://localhost:3000";

/** A module's contributions: the windowed Reports app, and a plain iframe page beside it. */
const ANSWER: ContributionsResponse = {
  pages: [
    {
      id: "reports.page",
      from: "ReportsModule",
      key: "reports",
      path: "/reports",
      nav: "none",
      admin: false,
      renderer: { iframe: { src: SRC, namespace: "reports" } },
      title: "Reports",
      titleZh: "报表",
      icon: "barChart",
      app: { order: 60 },
    },
    {
      id: "plain.page",
      from: "ReportsModule",
      key: "plain",
      path: "/plain",
      nav: "none",
      admin: false,
      renderer: { iframe: { src: "/api/reports-app/ui/plain.html", namespace: "reports" } },
      title: "Plain",
    },
  ],
  pageRemovals: [],
  agentTabs: [],
  sessionTabs: [],
};

const PAGES = pageTableFor(SYSTEM_APP_PAGES, ANSWER);

afterEach(async () => {
  await unmountAll();
  setActiveStrings(zh);
  vi.restoreAllMocks();
});

/** Switches the interface language, as Settings › General does. */
function SwitchLanguage() {
  const { setLang } = useLocale();
  return h("button", { onClick: () => setLang("zh") }, "Switch language");
}

async function open(at = "/apps") {
  setActiveStrings(en);
  localStorage.clear();
  agentServer(undefined, { workbenches: [] });
  const router = await mountAgentApp(h(ThemeProvider, null, h(AppCenterPage)), {
    route: "/apps",
    at,
    pages: PAGES,
    extra: [
      {
        path: "/app/:projectId/system_agent/:appKey",
        element: h(ThemeProvider, null, h(SystemAppPage)),
      },
      // Every other page of the table, as the shell mounts them: the redirect lives there.
      { path: "*", element: h(ThemeProvider, null, h(ShellRoutes)) },
    ],
    layers: [h(ThemeProvider, null, h(WorkspaceWindows)), h(SwitchLanguage)],
  });
  await until(() => tile() !== null || windowOf() !== null);
  return router;
}

/** Settles, letting real time pass too (the page gathers workbench news for a moment). */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (ready()) return;
    await run(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw new Error("the page never reached the awaited state");
}

const tile = () => document.querySelector<HTMLButtonElement>(`li[data-app="${KEY}"] > button`);
const grid = () =>
  document.querySelector<HTMLUListElement>(`ul[aria-label="${en.appCenter.title}"]`);
const windowOf = () => document.querySelector<HTMLElement>('section[aria-label="Reports"]');
const frame = () => windowOf()?.querySelector("iframe") ?? null;
/** The frame drawn outside any window: the full page's, or a plain contributed page's. */
const bareFrame = () =>
  [...document.querySelectorAll("iframe")].find((f) => f.closest("[data-window]") === null) ?? null;
const reachable = (el: Element) => el.closest("[data-window]")?.hasAttribute("inert") === false;
const windowAt = (at?: string) =>
  `/apps?${new URLSearchParams({ app: KEY, ...(at !== undefined ? { at } : {}) }).toString()}`;

/** The frame's page posts `data` to the app, as its own script would. */
async function post(from: HTMLIFrameElement | null, data: unknown, origin = ORIGIN) {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", { data, origin, source: from?.contentWindow }),
    );
  });
  await settle();
}

/** The frame's document arrives, as the page's own does when it loads. */
async function load(from: HTMLIFrameElement): Promise<HTMLElement> {
  const doc = from.contentDocument!;
  // jsdom fetches no frame document: the blank one it has stands in, rooted and done loading.
  if (doc.documentElement === null) doc.appendChild(doc.createElement("html"));
  Object.defineProperty(doc, "readyState", { value: "complete", configurable: true });
  await act(async () => {
    from.dispatchEvent(new Event("load"));
  });
  return doc.documentElement;
}

async function openWindow() {
  await click(tile()!);
  await until(() => frame() !== null);
  return frame()!;
}

it("opens the app's window from its tile, and minimize keeps the same frame running", async () => {
  const router = await open();
  expect(tile()!.getAttribute("aria-label")).toBe(en.appCenter.systemTileName("Reports", null));

  const app = await openWindow();
  expect(whereIs(router)).toBe(windowAt());
  expect(app.getAttribute("src")).toBe(SRC);
  expect(reachable(app)).toBe(true);
  expect(reachable(grid()!)).toBe(false);

  await pageAction("Reports", en.appCenter.windowMinimize);
  expect(whereIs(router)).toBe("/apps");
  expect(app.isConnected).toBe(true);
  expect(reachable(app)).toBe(false);
  expect(tile()!.getAttribute("aria-label")).toBe(
    en.appCenter.systemTileName("Reports", en.appCenter.running),
  );
  expect(tile()!.dataset["tooltip"]).toBe(en.appCenter.systemRunningTip("Reports"));

  await click(tile()!);
  expect(frame()).toBe(app);
  expect(reachable(app)).toBe(true);

  await pageAction("Reports", en.appCenter.windowClose);
  expect(app.isConnected).toBe(false);
});

it("keeps a contributed app in Apps until its window closes", async () => {
  const router = await open();
  const rows = () =>
    document.querySelectorAll<HTMLButtonElement>(
      `nav[aria-label="${en.sidebarApps.title}"] [data-app-row="${KEY}"]`,
    );
  const action = async (label: string) => {
    await click(
      rows()[0]!.closest("li")!.querySelector(`button[aria-label="${en.chat.moreActions}"]`)!,
    );
    await click(menuItem(label));
  };
  expect(rows()).toHaveLength(0);
  const documentFrame = await openWindow();
  await post(documentFrame, { type: "penguin:location", at: "/quarter" });
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.getAttribute("aria-current")).toBe("page");
  await action(en.appCenter.windowMinimize);
  expect(rows()).toHaveLength(1);
  expect(reachable(documentFrame)).toBe(false);
  await action(en.pageWorkspace.restore);
  expect(whereIs(router)).toBe(windowAt("/quarter"));
  expect(frame()).toBe(documentFrame);
  await action(en.common.close);
  expect(rows()).toHaveLength(0);
  expect(documentFrame.isConnected).toBe(false);
  expect(tile()).not.toBeNull();
});

it("leads the page's address and every address under it into the window, replacing the entry", async () => {
  const router = await open("/reports/r1?tab=a");
  await until(() => frame() !== null);
  expect(whereIs(router)).toBe(windowAt("/r1?tab=a"));
  // The page starts where the address said, as its document's fragment.
  expect(frame()!.getAttribute("src")).toBe(`${SRC}#/r1?tab=a`);

  // The old address was replaced: Back leaves for the entry before it, not for the old address.
  const app = frame()!;
  await run(() => router.navigate(-1));
  expect(whereIs(router)).toBe("/chat");

  // The page's own address names no place inside it: the running window comes back where it is.
  await run(() => router.navigate("/reports"));
  await until(() => whereIs(router) === windowAt("/r1?tab=a"));
  expect(frame()).toBe(app);

  // Once the app has ended, the same address opens it anew, at its start.
  await pageAction("Reports", en.appCenter.windowClose);
  await run(() => router.navigate("/reports"));
  await until(() => frame() !== null);
  expect(whereIs(router)).toBe(windowAt());
  expect(frame()!.getAttribute("src")).toBe(SRC);
});

it("keeps the page's moves in the address, and sends the address's own moves to the page", async () => {
  const router = await open();
  const app = await openWindow();
  const send = vi.spyOn(app.contentWindow!, "postMessage");

  await post(app, { type: "penguin:location", at: "/r1" });
  expect(whereIs(router)).toBe(windowAt("/r1"));
  await post(app, { type: "penguin:location", at: "/r2?tab=b" });
  expect(whereIs(router)).toBe(windowAt("/r2?tab=b"));
  // Its own moves are never sent back to it.
  expect(send).not.toHaveBeenCalled();

  // A link or a pasted address names another place: the page goes there, in the same document.
  await run(() => router.navigate(windowAt("/r9")));
  expect(send).toHaveBeenCalledWith({ type: "penguin:location", at: "/r9" }, ORIGIN);
  expect(frame()).toBe(app);
  expect(app.getAttribute("src")).toBe(SRC);

  // Minimized and brought back by its tile, the window is where its page is, and says so.
  await pageAction("Reports", en.appCenter.windowMinimize);
  await post(app, { type: "penguin:location", at: "/r3" });
  expect(whereIs(router)).not.toContain("r3");
  send.mockClear();
  await click(tile()!);
  await until(() => whereIs(router) === windowAt("/r3"));
  expect(send).not.toHaveBeenCalled();
});

it("takes the viewer where the page asks, within this app, and leaves the window running", async () => {
  const router = await open();
  const app = await openWindow();

  // Not a path of this app, the API, another frame, another origin: nothing happens.
  const stray = document.body.appendChild(document.createElement("iframe"));
  for (const [from, data, origin] of [
    [app, { type: "penguin:navigate", to: "//elsewhere.test/x" }, ORIGIN],
    [app, { type: "penguin:navigate", to: "https://elsewhere.test/" }, ORIGIN],
    [app, { type: "penguin:navigate", to: "/api/projects" }, ORIGIN],
    [app, { type: "penguin:navigate", to: "/\\elsewhere.test" }, ORIGIN],
    [stray, { type: "penguin:navigate", to: "/chat/s1" }, ORIGIN],
    [app, { type: "penguin:navigate", to: "/chat/s1" }, "http://elsewhere.test"],
  ] as const)
    await post(from, data, origin);
  expect(whereIs(router)).toBe(windowAt());

  await post(app, { type: "penguin:navigate", to: "/chat/s1" });
  expect(whereIs(router)).toBe("/chat/s1");
  expect(app.isConnected).toBe(true);
  expect(reachable(app)).toBe(false);

  // A minimized window's page cannot move the viewer.
  await post(app, { type: "penguin:navigate", to: "/agents" });
  expect(whereIs(router)).toBe("/chat/s1");

  // Back is where the window was.
  await run(() => router.navigate(-1));
  expect(whereIs(router)).toBe(windowAt());
  expect(reachable(app)).toBe(true);
});

it("opens full screen as the same document with no window, at the page's place, and comes back there", async () => {
  const router = await open();
  const app = await openWindow();
  await post(app, { type: "penguin:location", at: "/r1?tab=a" });

  await pageAction("Reports", en.appCenter.windowFullScreen);
  const fullPage = `/app/${PROJECT_ID}/system_agent/reports?${new URLSearchParams({ at: "/r1?tab=a" })}`;
  expect(whereIs(router)).toBe(fullPage);
  await until(() => bareFrame() !== null);
  expect(bareFrame()!.getAttribute("src")).toBe(`${SRC}#/r1?tab=a`);

  // The page moves on, full screen, and the exit returns to the window at that place.
  await post(bareFrame(), { type: "penguin:location", at: "/r2" });
  expect(whereIs(router)).toBe(
    `/app/${PROJECT_ID}/system_agent/reports?${new URLSearchParams({ at: "/r2" })}`,
  );
  await click(button(en.workbenches.exitFullPageButton));
  expect(whereIs(router)).toBe(windowAt("/r2"));
});

it("writes the interface language and the Project on the frame's root, and follows a language switch", async () => {
  const router = await open();
  const root = await load(await openWindow());
  expect(root.getAttribute("data-project-id")).toBe(PROJECT_ID);
  expect(root.getAttribute("lang")).toBe("en");

  // A contributed iframe page that is no system app opens at its own path, told the same.
  await run(() => router.navigate("/plain"));
  await until(() => bareFrame() !== null);
  const plain = await load(bareFrame()!);
  expect(plain.getAttribute("data-project-id")).toBe(PROJECT_ID);
  expect(whereIs(router)).toBe("/plain");

  await click(button("Switch language"));
  await waitFor(() => plain.getAttribute("lang") === "zh-CN");
  await waitFor(() => root.getAttribute("lang") === "zh-CN");
});
