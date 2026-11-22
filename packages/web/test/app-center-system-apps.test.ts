/** @vitest-environment jsdom */
/**
 * The system apps in the App Center (lib/system-apps.ts, features/app-center/system-tiles.ts):
 * the pages the system Agent owns, read from the page table, as tiles beside the workbenches.
 *
 * - Given no arrangement of the viewer's, the system apps come first, in their order, then the
 *   workbenches; an administrator sees five, a member four (no Machines).
 * - A system tile of the Web App's own opens its page at its own address, not a window, and its
 *   hint says it is a system app (a server module's iframe one opens in the window:
 *   app-center-frame-apps.test.ts).
 * - Its menu only opens and arranges it: no full screen, no Agent settings, no removal. "Move to…"
 *   puts it into a folder, and the stored arrangement names it `system_agent/<page key>`.
 * - Given an arrangement that does not name the system apps, they are appended after it.
 * - Given a page a server module contributes with `app` and a title, it is a tile too; one with
 *   `app` but no title is not (the console says why).
 * - A machine's tiles never include a system app: the system apps show once, as this server's.
 * - While no Agent has an app here, what a workbench is and the one AI button sit under the system
 *   apps, and the header carries no AI button.
 * - When the server's list cannot be read, the system apps still show and still open.
 */
import { act, createElement as h } from "react";
import { afterEach, beforeAll, afterAll, expect, it, vi } from "vitest";
import type {
  AppCenterLayout,
  ContributionsResponse,
  WorkbenchInfo,
} from "@prismshadow/penguin-server/api";
import { AppCenterPage } from "../src/features/app-center/app-center-page";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ThemeProvider } from "../src/state/theme";
import { pageTableFor } from "../src/web-app/contributions";
import type { WebAppPage } from "../src/web-app/page-table";
import { AGENT_ID, agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import { button, click, menuItem, unmountAll, waitFor } from "./helpers/dom";
import { SYSTEM_APP_PAGES } from "./helpers/system-app-pages";

const board: WorkbenchInfo = {
  id: "board",
  name: "board",
  version: "1.0.0",
  revision: "abcdef012345",
  uiRev: "0123456789ab",
  loadedAt: "2026-11-04T00:00:00Z",
  error: null,
  hints: [],
  tabs: [
    { id: "board.main", key: "main", title: "Board", renderer: { iframe: { src: "/ui/board" } } },
  ],
  appCenter: { show: true },
};

const BOARD = `${AGENT_ID}/board`;
const system = (key: string) => `system_agent/${key}`;
const ADMIN_SYSTEM = ["models", "plugins", "machines", "usage", "benchmark"].map(system);

beforeAll(() => setActiveStrings(en));
afterAll(() => setActiveStrings(zh));
afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

async function open(
  options: {
    workbenches?: WorkbenchInfo[];
    layout?: AppCenterLayout;
    serverAdmin?: boolean;
    machines?: FakeMachine[];
    pages?: readonly WebAppPage[];
    failRead?: boolean;
  } = {},
) {
  const server = agentServer(undefined, {
    workbenches: options.workbenches ?? [board],
    ...(options.layout !== undefined ? { appCenterLayout: options.layout } : {}),
    ...(options.serverAdmin !== undefined ? { admin: options.serverAdmin } : {}),
    ...(options.machines !== undefined ? { machines: options.machines } : {}),
  });
  // Every read of this server's list fails: the page reads again when the Agent list arrives.
  if (options.failRead === true) {
    for (let i = 0; i < 5; i++) server.failNext(null, /\/app-center$/);
  }
  const router = await mountAgentApp(h(ThemeProvider, null, h(AppCenterPage)), {
    route: "/apps",
    at: "/apps",
    pages: options.pages ?? SYSTEM_APP_PAGES,
    extra: SYSTEM_APP_PAGES.map((page) => ({ path: page.path, element: h("p", null, page.key) })),
  });
  await waitFor(() => order().length > 0, 40);
  return { server, router };
}

/** The grid. */
const grid = () => document.querySelector<HTMLElement>(`ul[aria-label="${en.appCenter.title}"]`);
/** The grid's items in order: an app by its key, a folder as `folder`. */
const order = () =>
  [...(grid()?.children ?? [])].map((li) => (li as HTMLElement).dataset["app"] ?? "folder");
const tile = (key: string) =>
  document.querySelector<HTMLButtonElement>(`li[data-app="${key}"] > button`)!;

/** The labels of the open menu's rows, top to bottom. */
const menuRows = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].map(
    (row) => row.textContent?.trim() ?? "",
  );

async function openMenu(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }),
    );
  });
  await waitFor(() => menuRows().length > 0);
}

it("puts the system apps first, in their order, then the workbenches", async () => {
  await open();
  expect(order()).toEqual([...ADMIN_SYSTEM, BOARD]);
});

it("shows a member the system apps without Machines", async () => {
  await open({ serverAdmin: false });
  expect(order()).toEqual([
    system("models"),
    system("plugins"),
    system("usage"),
    system("benchmark"),
    BOARD,
  ]);
});

it("opens a system app as its own page, and says it is a system app", async () => {
  const { router } = await open();
  expect(tile(system("models")).dataset["tooltip"]).toBe(
    en.appCenter.systemTileName("Models", null),
  );
  await click(tile(system("models")));
  expect(whereIs(router)).toBe("/models");
});

it("offers only opening and arranging on a system app, and folds it in by Move to…", async () => {
  const { server, router } = await open();
  await openMenu(tile(system("plugins")));
  expect(menuRows()).toEqual([
    en.appCenter.menu.open,
    en.appCenter.menu.moveTo,
    en.appCenter.menu.moveForward,
    en.appCenter.menu.moveBackward,
  ]);
  await click(menuItem(en.appCenter.menu.moveTo));
  await click(menuItem("Board"));
  await waitFor(() => server.appCenterLayout() !== null);
  expect(server.appCenterLayout()?.items).toContainEqual({
    type: "folder",
    id: expect.any(String),
    name: en.appCenter.newFolder,
    apps: [BOARD, system("plugins")],
  });
  expect(whereIs(router)).toBe("/apps");
});

it("appends the system apps to an arrangement that does not name them", async () => {
  await open({ layout: { v: 1, items: [{ type: "app", app: BOARD }] } });
  expect(order()).toEqual([BOARD, ...ADMIN_SYSTEM]);
});

it("lists a server module's titled app page as a tile, and not one without a title", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const page = (key: string, title?: string) => ({
    id: `backup.${key}`,
    from: "BackupModule",
    key,
    path: `/${key}`,
    nav: "none" as const,
    admin: false,
    renderer: { iframe: { src: `/ui/${key}`, namespace: "backup" } },
    ...(title !== undefined ? { title } : {}),
    icon: "server",
    app: { order: 60 },
  });
  const answer: ContributionsResponse = {
    pages: [page("backups", "Backups"), page("monitor")],
    fileRenderers: [],
    pageRemovals: [],
    agentTabs: [],
    sessionTabs: [],
  };
  const pages = pageTableFor(SYSTEM_APP_PAGES, answer, new Map());
  await open({ pages });
  expect(order()).toEqual([...ADMIN_SYSTEM, system("backups"), BOARD]);
  // The untitled page is still routed, only not an app.
  expect(pages.some((p) => p.key === "monitor")).toBe(true);
  expect(warn).toHaveBeenCalledTimes(1);
});

it("never takes a system app from a machine's tiles", async () => {
  await open({ machines: [{ machineId: "gpu1", alias: "gpu-box", agents: [AGENT_ID] }] });
  await waitFor(() => order().includes(`gpu1:${BOARD}`), 40);
  expect(order()).toEqual([...ADMIN_SYSTEM, BOARD, `gpu1:${BOARD}`]);
});

it("explains workbenches under the system apps while no Agent has one here", async () => {
  await open({ workbenches: [] });
  expect(order()).toEqual(ADMIN_SYSTEM);
  expect(document.body.textContent).toContain(en.appCenter.workbenchesEmptyTitle);
  expect(document.body.textContent).toContain(en.appCenter.empty);
  const ai = [...document.querySelectorAll("button")].filter(
    (b) => b.textContent?.trim() === en.aiCreate.withAi,
  );
  expect(ai).toHaveLength(1);
  // Under the grid, not in the header beside New folder.
  expect(grid()!.compareDocumentPosition(ai[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const newFolder = button(en.appCenter.newFolderAction);
  expect(
    newFolder.compareDocumentPosition(grid()!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("still shows and opens the system apps when the server's list cannot be read", async () => {
  const { router } = await open({ failRead: true });
  expect(order()).toEqual(ADMIN_SYSTEM);
  expect(document.body.textContent).not.toContain(en.appCenter.workbenchesEmptyTitle);
  await click(tile(system("benchmark")));
  expect(whereIs(router)).toBe("/benchmark");
});
