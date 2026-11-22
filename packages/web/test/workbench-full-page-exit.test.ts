/** @vitest-environment jsdom */
/**
 * The full page's exit (features/workbenches/workbench-app-page.tsx), with the shell's windows
 * beside it: one fake server, the real page, windows and palette registry.
 *
 * - Given the full page opened from an app's window, the exit lands on that window, at the page
 *   the full page showed, with the app started again; the palette names the window as the way
 *   back.
 * - Given the full page reached with nothing to return to (a link, `penguin web --app`), the exit
 *   opens the app's window all the same.
 * - Given the full page opened from a tile of the App Center's grid, the exit goes back to the
 *   grid, and the palette says the App Center.
 */
import { createElement as h } from "react";
import { afterEach, expect, it } from "vitest";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { AppCenterWindows } from "../src/features/app-center/app-center-windows";
import { WorkbenchAppPage } from "../src/features/workbenches/workbench-app-page";
import { addedPaletteActions } from "../src/lib/palette-actions";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ThemeProvider } from "../src/state/theme";
import { AGENT_ID, PROJECT_ID, agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import { run, unmountAll, waitFor } from "./helpers/dom";

const page = (key: string, title: string) => ({
  id: `board.${key}`,
  key,
  title,
  renderer: { iframe: { src: `/ui/board/${key}` } },
});
const BOARD: WorkbenchInfo = {
  id: "board",
  name: "board",
  version: "1.0.0",
  revision: "abcdef012345",
  uiRev: "0123456789ab",
  loadedAt: "2026-11-04T00:00:00Z",
  error: null,
  hints: [],
  tabs: [page("main", "Board"), page("stats", "Stats")],
  appCenter: { show: true },
};
const KEY = `${AGENT_ID}/board`;
const WINDOW = `/apps?app=${encodeURIComponent(KEY)}`;

/** The full page of the board's Stats page, arrived at with `returnTo` (none: a link). */
async function fullPage(returnTo?: string) {
  setActiveStrings(en);
  agentServer(undefined, { workbenches: [BOARD] });
  const router = await mountAgentApp(h(ThemeProvider, null, h(WorkbenchAppPage)), {
    route: "/app/:projectId/:agentId/:workbenchId/:tabKey",
    at: "/chat",
    extra: [{ path: "/apps", element: h("p", null, "App Center") }],
    layers: [h(ThemeProvider, null, h(AppCenterWindows))],
  });
  await run(() =>
    router.navigate(
      `/app/${PROJECT_ID}/${AGENT_ID}/board/stats`,
      returnTo === undefined ? {} : { state: { returnTo } },
    ),
  );
  await waitFor(() => document.querySelector('iframe[title="Stats"]') !== null);
  return router;
}

const appWindow = () => document.querySelector<HTMLElement>('section[aria-label="Board"]');
const exitAction = () => addedPaletteActions().find((a) => a.id === "exit-full-page");
const exitLabel = () => exitAction()?.label;
/** The exit, as the command palette runs it. */
const exit = () => run(() => exitAction()!.run());

afterEach(async () => {
  await unmountAll();
  setActiveStrings(zh);
});

it("returns to the window it was opened from, at the page it showed, the app running again", async () => {
  const router = await fullPage(WINDOW);
  expect(exitLabel()).toBe(en.workbenches.exitToWindow);

  await exit();
  expect(whereIs(router)).toBe(WINDOW);
  await waitFor(() => appWindow()?.querySelector("iframe") != null);
  expect(appWindow()!.querySelector("iframe")!.getAttribute("title")).toBe("Stats");
  expect(appWindow()!.closest("[data-window]")!.hasAttribute("inert")).toBe(false);
});

it("opens the app's window when nothing opened the full page", async () => {
  const router = await fullPage();
  expect(exitLabel()).toBe(en.workbenches.exitToWindow);

  await exit();
  expect(whereIs(router)).toBe(WINDOW);
  await waitFor(() => appWindow()?.querySelector("iframe") != null);
});

it("goes back to the App Center's grid when a tile opened it", async () => {
  const router = await fullPage("/apps");
  expect(exitLabel()).toBe(en.workbenches.exitToAppCenter);

  await exit();
  expect(whereIs(router)).toBe("/apps");
  expect(appWindow()).toBeNull();
});
