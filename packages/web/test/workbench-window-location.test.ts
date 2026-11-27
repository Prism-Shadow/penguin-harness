/** @vitest-environment jsdom */
/**
 * An Agent workbench's page keeps its own place in its App Center window's address and on its
 * full page, the way a system app's page does (lib/frame-address.ts, lib/frame-location.ts). The
 * fixture is a made-up "Board" workbench of one page, and one of two pages for the page switch;
 * nothing here is specific to any one app.
 *
 * - The window's `at` reaches the page as its document's fragment; the page's own moves
 *   (`penguin:location`) replace `at` without a history entry; an `at` the address gains on its
 *   own (a pasted address, Back) reaches the page as the same message, in the same document. An
 *   address that names no place brings a running window back where its page is.
 * - `penguin:navigate` takes the viewer to a path of this app, leaving the window minimized and
 *   running; another origin's path, the API, another frame's message and a minimized window's
 *   page are ignored.
 * - Full screen opens at the page's place, keeps the page's moves in its own address, and its exit
 *   comes back to the window there.
 * - Switching to another page of the workbench starts that page at its root.
 * - The frame's root carries the interface language and the current Project, and follows a
 *   language switch.
 */
import { act, createElement as h } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { AppCenterPage } from "../src/features/app-center/app-center-page";
import { WorkbenchAppPage } from "../src/features/workbenches/workbench-app-page";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { useLocale } from "../src/state/locale";
import { ThemeProvider } from "../src/state/theme";
import {
  AGENT_ID,
  PROJECT_ID,
  agentServer,
  buttonIn,
  mountAgentApp,
  whereIs,
} from "./helpers/agent-app";
import { button, click, run, settle, unmountAll, waitFor } from "./helpers/dom";
import { WorkspaceWindows, pageAction } from "./helpers/workspace-windows";

const ORIGIN = "http://localhost:3000";
const UI_REV = "0123456789ab";
const KEY = `${AGENT_ID}/board`;

const page = (key: string, title: string) => ({
  id: `board.${key}`,
  key,
  title,
  renderer: { iframe: { src: `/ui/board/${key}` } },
});
const board = (pages: ReturnType<typeof page>[]): WorkbenchInfo => ({
  id: "board",
  name: "board",
  version: "1.0.0",
  revision: "abcdef012345",
  uiRev: UI_REV,
  loadedAt: "2026-11-26T00:00:00Z",
  error: null,
  hints: [],
  tabs: pages,
  appCenter: { show: true },
});
const BOARD = board([page("main", "Board")]);
/** The document a page of the board loads, before any fragment. */
const srcOf = (key: string) => `/ui/board/${key}?rev=${UI_REV}`;

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

async function open(at = "/apps", workbench = BOARD) {
  setActiveStrings(en);
  localStorage.clear();
  agentServer(undefined, { workbenches: [workbench] });
  const fullPage = h(ThemeProvider, null, h(WorkbenchAppPage));
  const router = await mountAgentApp(h(ThemeProvider, null, h(AppCenterPage)), {
    route: "/apps",
    at,
    extra: [
      { path: "/app/:projectId/:agentId/:workbenchId", element: fullPage },
      { path: "/app/:projectId/:agentId/:workbenchId/:tabKey", element: fullPage },
    ],
    layers: [h(ThemeProvider, null, h(WorkspaceWindows)), h(SwitchLanguage)],
  });
  await until(() => tile() !== null || frame() !== null);
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
const windowOf = () => document.querySelector<HTMLElement>('section[aria-label="Board"]');
const frame = () => windowOf()?.querySelector("iframe") ?? null;
/** The frame drawn outside any window: the full page's. */
const bareFrame = () =>
  [...document.querySelectorAll("iframe")].find((f) => f.closest("[data-window]") === null) ?? null;
const reachable = (el: Element) => el.closest("[data-window]")?.hasAttribute("inert") === false;
const windowAt = (at?: string) =>
  `/apps?${new URLSearchParams({ app: KEY, ...(at !== undefined ? { at } : {}) }).toString()}`;
const fullPageAt = (at: string) =>
  `/app/${PROJECT_ID}/${AGENT_ID}/board/main?${new URLSearchParams({ at }).toString()}`;

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

it("starts the page where the window's address says, as its document's fragment", async () => {
  await open(windowAt("/r1?tab=a"));
  await until(() => frame() !== null);
  expect(frame()!.getAttribute("src")).toBe(`${srcOf("main")}#/r1?tab=a`);
});

it("keeps the page's moves in the address without a history entry, and sends the address's own moves to the page", async () => {
  const router = await open();
  const app = await openWindow();
  // A page that has said nothing loads its document as it is.
  expect(app.getAttribute("src")).toBe(srcOf("main"));
  const send = vi.spyOn(app.contentWindow!, "postMessage");

  await post(app, { type: "penguin:location", at: "/r1" });
  expect(whereIs(router)).toBe(windowAt("/r1"));
  await post(app, { type: "penguin:location", at: "/r2?tab=b" });
  expect(whereIs(router)).toBe(windowAt("/r2?tab=b"));
  // Its own moves are never sent back to it.
  expect(send).not.toHaveBeenCalled();

  // A pasted address names another place: the page goes there, in the same document.
  await run(() => router.navigate(windowAt("/r9")));
  expect(send).toHaveBeenCalledWith({ type: "penguin:location", at: "/r9" }, ORIGIN);
  // Back returns to the entry the page's moves replaced, and the page follows it there.
  send.mockClear();
  await run(() => router.navigate(-1));
  expect(whereIs(router)).toBe(windowAt("/r2?tab=b"));
  expect(send).toHaveBeenCalledWith({ type: "penguin:location", at: "/r2?tab=b" }, ORIGIN);
  expect(frame()).toBe(app);
  expect(app.getAttribute("src")).toBe(srcOf("main"));

  // The page's moves added no entry: one more Back leaves the window for the grid it opened over.
  await run(() => router.navigate(-1));
  expect(whereIs(router)).toBe("/apps");
});

it("brings a running window back where its page is, from an address that names no place", async () => {
  const router = await open();
  const app = await openWindow();
  await pageAction("Board", en.appCenter.windowMinimize);
  // A minimized window's page moves on: the viewer's address stays as it is.
  await post(app, { type: "penguin:location", at: "/r3" });
  expect(whereIs(router)).toBe("/apps");

  const send = vi.spyOn(app.contentWindow!, "postMessage");
  await click(tile()!);
  await until(() => whereIs(router) === windowAt("/r3"));
  expect(frame()).toBe(app);
  expect(send).not.toHaveBeenCalled();
});

it("takes the viewer where the page asks, within this app, and leaves the window running minimized", async () => {
  const router = await open();
  const app = await openWindow();

  // Not a path of this app, the API, another frame, another origin: nothing happens.
  const stray = document.body.appendChild(document.createElement("iframe"));
  for (const [from, data, origin] of [
    [app, { type: "penguin:navigate", to: "//elsewhere.test/x" }, ORIGIN],
    [app, { type: "penguin:navigate", to: "https://elsewhere.test/" }, ORIGIN],
    [app, { type: "penguin:navigate", to: "/api/x" }, ORIGIN],
    [stray, { type: "penguin:navigate", to: "/chat/1" }, ORIGIN],
    [stray, { type: "penguin:location", at: "/stray" }, ORIGIN],
    [app, { type: "penguin:navigate", to: "/chat/1" }, "http://elsewhere.test"],
  ] as const)
    await post(from, data, origin);
  expect(whereIs(router)).toBe(windowAt());

  await post(app, { type: "penguin:navigate", to: "/chat/1" });
  expect(whereIs(router)).toBe("/chat/1");
  expect(app.isConnected).toBe(true);
  expect(reachable(app)).toBe(false);

  // A minimized window's page cannot move the viewer.
  await post(app, { type: "penguin:navigate", to: "/agents" });
  expect(whereIs(router)).toBe("/chat/1");

  // Back is where the window was.
  await run(() => router.navigate(-1));
  expect(whereIs(router)).toBe(windowAt());
  expect(frame()).toBe(app);
  expect(reachable(app)).toBe(true);
});

it("opens full screen at the page's place, keeps its moves there, and comes back to the window at that place", async () => {
  const router = await open();
  const app = await openWindow();
  await post(app, { type: "penguin:location", at: "/r1?tab=a" });

  await pageAction("Board", en.appCenter.windowFullScreen);
  expect(whereIs(router)).toBe(fullPageAt("/r1?tab=a"));
  await until(() => bareFrame() !== null);
  expect(bareFrame()!.getAttribute("src")).toBe(`${srcOf("main")}#/r1?tab=a`);

  // The page moves on, full screen, and the exit returns to the window at that place.
  await post(bareFrame(), { type: "penguin:location", at: "/r2" });
  expect(whereIs(router)).toBe(fullPageAt("/r2"));
  await click(button(en.workbenches.exitFullPageButton));
  expect(whereIs(router)).toBe(windowAt("/r2"));
  await until(() => frame() !== null && reachable(frame()!));
});

it("asked by its page to fill the app, opens the full page at the page's place", async () => {
  const router = await open();
  const app = await openWindow();
  await post(app, { type: "penguin:location", at: "/r1" });
  await post(app, { type: "penguin:fill-app" });
  expect(whereIs(router)).toBe(fullPageAt("/r1"));
});

it("starts another page of the workbench at its root, and the address forgets the page before's place", async () => {
  const router = await open(
    windowAt("/r1"),
    board([page("main", "Board"), page("stats", "Stats")]),
  );
  await until(() => frame() !== null);
  expect(frame()!.getAttribute("src")).toBe(`${srcOf("main")}#/r1`);

  await click(buttonIn(windowOf()!, "Stats"));
  await until(() => frame()?.getAttribute("title") === "Stats");
  expect(frame()!.getAttribute("src")).toBe(srcOf("stats"));
  expect(whereIs(router)).toBe(windowAt());
});

it("writes the interface language and the Project on the frame's root, and follows a language switch", async () => {
  await open();
  const root = await load(await openWindow());
  expect(root.getAttribute("data-project-id")).toBe(PROJECT_ID);
  expect(root.getAttribute("lang")).toBe("en");

  await click(button("Switch language"));
  await waitFor(() => root.getAttribute("lang") === "zh-CN");
  expect(root.getAttribute("data-project-id")).toBe(PROJECT_ID);
});
