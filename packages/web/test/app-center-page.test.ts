/** @vitest-environment jsdom */
/**
 * The App Center page (/apps): the Project's home screen of workbench shortcuts.
 *
 * - A tile is the app's icon and name only; its hint names the whole title and the Agent. The
 *   tiles keep the server's order until the viewer arranges them.
 * - A click opens the app windowed over the grid (`?app=`), whose close returns to the grid;
 *   "Open full screen" in the tile's menu opens the full page with the way back to the App Center.
 * - Minimize (or Back) returns to the grid and the app keeps running: its frame stays mounted, out
 *   of sight and reach, and its tile says it is running; a click on that tile brings back the
 *   same frame rather than a new one. Close ends the app: its frame is gone and its tile plain,
 *   and opening it again starts a new frame. A folder holding a running app says how many run.
 * - Several apps run at once, and a running app outlives a visit to another page; switching
 *   Project ends the apps of the Project left.
 * - A surface outside the App Center lists the running apps, each saying whether its window is in
 *   front, and brings one back from another page: the same frame, and its minimize returns to
 *   that page.
 * - A building tile does not open, by click or by its menu, and turns live by itself when the
 *   server says the workbench loaded; the news that a load started turns a tile to building.
 * - A failed tile still opens, and its menu shows the recorded error.
 * - "View in agent settings" opens the Agent's settings on the Workbenches sub-page.
 * - Dragging a tile beside another reorders the grid, onto another makes a folder; the menu's
 *   forward and backward move one too. Each arrangement is stored as the viewer's layout, and a
 *   write the server refuses puts the grid back to what is stored.
 * - A folder is renamed and ungrouped from its menu; "Move to…" makes one from the keyboard; an
 *   app dragged out of the open folder onto its backdrop leaves the folder. A folder keeps its
 *   one app, and goes once the last app leaves it.
 * - The header's New folder opens a dialog: the name starts as "New folder", selected, and
 *   Create waits for a checked app; the folder is made of the checked apps at the first one's
 *   place. "New folder…" in a tile's "Move to…" opens it with that app checked.
 * - Restoring the default order asks first, and only the confirmation clears the layout.
 * - The menus open on right-click, Shift+F10 and the ContextMenu key; Esc closes one and hands
 *   focus back to its tile. A right-click outside the App Center keeps the browser's own menu.
 * - With nothing shown, the page says what a workbench is and offers to have one built.
 */
import { act, createElement as h } from "react";
import { afterEach, expect, it } from "vitest";
import type { AppCenterLayout, WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { AppCenterPage } from "../src/features/app-center/app-center-page";
import { AppCenterWindows } from "../src/features/app-center/app-center-windows";
import { useRestoreApp, useRunningApps } from "../src/lib/running-apps";
import { useProject } from "../src/state/project";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { WORKBENCH_BUILDING_EVENT, WORKBENCH_UPDATED_EVENT } from "../src/lib/workbench-tabs";
import { ThemeProvider } from "../src/state/theme";
import {
  AGENT_ID,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  agentServer,
  buttonIn,
  mountAgentApp,
  topDialog,
  whereIs,
} from "./helpers/agent-app";
import { button, click, pressEscape, run, settle, type, unmountAll } from "./helpers/dom";

const workbench = (id: string, over: Partial<WorkbenchInfo> = {}): WorkbenchInfo => ({
  id,
  name: id,
  version: "1.0.0",
  revision: "abcdef012345",
  uiRev: "0123456789ab",
  loadedAt: "2026-11-04T00:00:00Z",
  error: null,
  hints: [],
  tabs: [
    {
      id: `${id}.main`,
      key: "main",
      title: id[0]!.toUpperCase() + id.slice(1),
      renderer: { iframe: { src: `/ui/${id}` } },
    },
  ],
  appCenter: { show: true },
  ...over,
});

const key = (id: string) => `${AGENT_ID}/${id}`;

/** Switches to the other Project, as the sidebar's Project switcher does. */
function SwitchProject() {
  const { setCurrentProjectId } = useProject();
  return h("button", { onClick: () => setCurrentProjectId(OTHER_PROJECT_ID) }, "Switch Project");
}

/** A surface outside the App Center that lists the running apps, as the sidebar's list does. */
function RunningList() {
  const running = useRunningApps();
  const restore = useRestoreApp();
  return h(
    "ul",
    { "aria-label": "Running apps" },
    running.map((app) =>
      h(
        "li",
        { key: app.key },
        h("button", { "aria-pressed": app.shown, onClick: () => restore(app.key) }, app.title),
      ),
    ),
  );
}

async function open(
  workbenches: WorkbenchInfo[],
  options: { layout?: AppCenterLayout; building?: string[]; otherProject?: boolean } = {},
) {
  setActiveStrings(en);
  const server = agentServer(undefined, {
    workbenches,
    ...(options.layout !== undefined ? { appCenterLayout: options.layout } : {}),
    ...(options.otherProject === true ? { otherProject: true } : {}),
  });
  for (const id of options.building ?? []) server.setBuilding(id, true);
  const router = await mountAgentApp(h(ThemeProvider, null, h(AppCenterPage)), {
    route: "/apps",
    at: "/apps",
    extra: [
      { path: "/app/:projectId/:agentId/:workbenchId", element: h("p", null, "Workbench page") },
      {
        path: "/app/:projectId/:agentId/:workbenchId/:tabKey",
        element: h("p", null, "Workbench page"),
      },
    ],
    // The App Center's windows live in the shell's layer over the page area, beside every page.
    layers: [
      h(ThemeProvider, null, h(AppCenterWindows)),
      h(RunningList),
      ...(options.otherProject === true ? [h(SwitchProject)] : []),
    ],
  });
  await until(
    () => grid() !== null || document.body.textContent?.includes(en.appCenter.emptyTitle) === true,
  );
  return { server, router };
}

/** Settles, letting real time pass too (the page gathers workbench news for a moment). */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (ready()) return;
    await run(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw new Error("the page never reached the awaited state");
}

/** What a reader reads of an element: its text outside `aria-hidden` subtrees (a letter tile). */
function spoken(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") return "";
  return [...node.childNodes].map(spoken).join(" ").replace(/\s+/g, " ").trim();
}

const grid = () =>
  document.querySelector<HTMLUListElement>(`ul[aria-label="${en.appCenter.title}"]`);
/** The grid's items in order: an app by its key, a folder as `folder:<name>`. */
const order = () =>
  [...(grid()?.children ?? [])].map((li) => {
    const el = li as HTMLElement;
    return el.dataset["app"] ?? `folder:${spoken(el.querySelector("button")!)}`;
  });
const item = (id: string) => document.querySelector<HTMLLIElement>(`li[data-app="${id}"]`)!;
const tileButton = (id: string) => item(id).querySelector("button")!;
const folderButton = (name: string) =>
  [...document.querySelectorAll<HTMLLIElement>("li[data-folder] > button")].find(
    (b) => spoken(b) === name,
  )!;

/** An app's window by its title, shown or minimized, and the frame inside it. */
const windowOf = (title: string) =>
  document.querySelector<HTMLElement>(`section[aria-label="${title}"]`);
const frameOf = (title: string) => windowOf(title)?.querySelector("iframe") ?? null;
/** Whether the element is on screen and reachable: no window around it is hidden. */
const reachable = (el: Element) => el.closest("[data-window]")?.hasAttribute("inert") === false;
/** The tile's accessible name with the state it carries. */
const tileNamed = (id: string) => tileButton(key(id)).getAttribute("aria-label");
/** The running apps the outside list shows, each with whether its window is in front. */
const listed = () =>
  [...document.querySelectorAll('ul[aria-label="Running apps"] button')].map(
    (b) => `${b.textContent}${b.getAttribute("aria-pressed") === "true" ? " (in front)" : ""}`,
  );

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const menuItem = (label: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (row) => spoken(row) === label,
  );
  if (found === undefined) throw new Error(`no menu row ${JSON.stringify(label)}`);
  return found;
};

async function rightClick(target: Element, x = 40, y = 60): Promise<boolean> {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: x,
    clientY: y,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle();
  return event.defaultPrevented;
}

async function press(target: HTMLElement, init: KeyboardEventInit): Promise<void> {
  target.focus();
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
  await settle();
}

/** A drag event: jsdom has no DragEvent, and React reads only the type, the point and the data. */
function dragEvent(kind: string, clientX = 0): Event {
  const event = new MouseEvent(kind, { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(event, "dataTransfer", {
    value: { setData() {}, getData: () => "", effectAllowed: "", dropEffect: "" },
  });
  return event;
}

/** Drags `from` over `to` and drops it at `x`, on a tile 100 px wide starting at 0. */
async function drag(from: Element, to: HTMLElement, x: number): Promise<void> {
  to.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 100 }) as DOMRect;
  await act(async () => {
    from.dispatchEvent(dragEvent("dragstart"));
  });
  await act(async () => {
    to.dispatchEvent(dragEvent("dragover", x));
    to.dispatchEvent(dragEvent("drop", x));
    from.dispatchEvent(dragEvent("dragend"));
  });
  await settle();
}

/** The new-folder dialog's checkbox for the app titled `title`. */
const appBox = (title: string) =>
  [...topDialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((box) =>
    spoken(box.closest("label")!).startsWith(title),
  )!;
/** The titles of the apps checked in the new-folder dialog, in its order. */
const checkedApps = () =>
  [...topDialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .filter((box) => box.checked)
    .map((box) => spoken(box.closest("label")!.querySelector(".truncate")!));

/** Drags an app of the open folder out onto the folder's backdrop. */
async function dragOut(id: string): Promise<void> {
  const scrim = document.querySelector(".ui-scrim")!;
  await act(async () => {
    topDialog().querySelector(`li[data-app="${id}"]`)!.dispatchEvent(dragEvent("dragstart"));
  });
  await act(async () => {
    scrim.dispatchEvent(dragEvent("dragover", 5));
    scrim.dispatchEvent(dragEvent("drop", 5));
  });
  await settle();
}

const news = (event: string) =>
  run(() =>
    window.dispatchEvent(
      new CustomEvent(event, {
        detail: { projectId: PROJECT_ID, agentId: AGENT_ID, workbenchId: "board" },
      }),
    ),
  );

afterEach(async () => {
  await unmountAll();
  setActiveStrings(zh);
});

it("shows each tile as its icon and name, in the server's order, with the Agent in its hint", async () => {
  await open([
    workbench("board"),
    workbench("notes"),
    workbench("hidden", { appCenter: { show: false } }),
  ]);
  expect(order()).toEqual([key("board"), key("notes")]);
  // The ids are the address, never the text; the Agent is not written on the tile.
  expect(spoken(tileButton(key("board")))).toBe("Board");
  expect(tileButton(key("board")).getAttribute("data-tooltip")).toBe(
    en.appCenter.tileTip("Board", "Helper"),
  );
});

it("opens an app windowed over the grid, and its close returns to the grid", async () => {
  const { router } = await open([workbench("board")]);
  await click(tileButton(key("board")));
  expect(whereIs(router)).toBe(`/apps?app=${encodeURIComponent(key("board"))}`);
  await until(() => document.querySelector('section[aria-label="Board"]') !== null);
  // The grid stays mounted underneath, out of reach.
  expect(grid()?.closest("[data-window]")?.hasAttribute("inert")).toBe(true);

  await click(button(en.appCenter.windowClose));
  expect(whereIs(router)).toBe("/apps");
  expect(grid()?.closest("[data-window]")?.hasAttribute("inert")).toBe(false);
});

it("minimizes an app to its tile, still running, and its tile brings back the same window", async () => {
  const { router } = await open([workbench("board"), workbench("notes")]);
  await click(tileButton(key("board")));
  await until(() => frameOf("Board") !== null);
  const frame = frameOf("Board")!;

  await click(buttonIn(windowOf("Board")!, en.appCenter.windowMinimize));
  expect(whereIs(router)).toBe("/apps");
  expect(reachable(grid()!)).toBe(true);
  // The app keeps running: its frame is the same element, mounted but out of sight and reach.
  expect(frame.isConnected).toBe(true);
  expect(reachable(frame)).toBe(false);
  expect(tileNamed("board")).toBe(en.appCenter.tileName("Board", "Helper", en.appCenter.running));
  expect(tileButton(key("board")).getAttribute("data-tooltip")).toBe(
    en.appCenter.runningTip("Board", "Helper"),
  );
  expect(tileNamed("notes")).toBe(en.appCenter.tileName("Notes", "Helper", null));

  await click(tileButton(key("board")));
  expect(whereIs(router)).toBe(`/apps?app=${encodeURIComponent(key("board"))}`);
  expect(frameOf("Board")).toBe(frame);
  expect(reachable(frame)).toBe(true);
  expect(reachable(grid()!)).toBe(false);
  expect(document.querySelectorAll("iframe")).toHaveLength(1);

  // Back leaves the window the way minimize does.
  await run(() => router.navigate(-1));
  expect(whereIs(router)).toBe("/apps");
  expect(frame.isConnected).toBe(true);
  expect(tileNamed("board")).toBe(en.appCenter.tileName("Board", "Helper", en.appCenter.running));
});

it("closing an app ends it: the frame goes, the tile is plain, and opening it starts anew", async () => {
  await open([workbench("board")]);
  await click(tileButton(key("board")));
  await until(() => frameOf("Board") !== null);
  const frame = frameOf("Board")!;

  await click(buttonIn(windowOf("Board")!, en.appCenter.windowClose));
  expect(frame.isConnected).toBe(false);
  expect(windowOf("Board")).toBeNull();
  expect(tileNamed("board")).toBe(en.appCenter.tileName("Board", "Helper", null));
  expect(reachable(grid()!)).toBe(true);

  await click(tileButton(key("board")));
  await until(() => frameOf("Board") !== null);
  expect(frameOf("Board")).not.toBe(frame);
});

it("keeps several apps running at once, and through a visit to another page", async () => {
  const { router } = await open([workbench("board"), workbench("notes")]);
  await click(tileButton(key("board")));
  await until(() => frameOf("Board") !== null);
  const board = frameOf("Board")!;
  await click(buttonIn(windowOf("Board")!, en.appCenter.windowMinimize));
  await click(tileButton(key("notes")));
  await until(() => frameOf("Notes") !== null);
  const notes = frameOf("Notes")!;
  await click(buttonIn(windowOf("Notes")!, en.appCenter.windowMinimize));
  expect(tileNamed("board")).toBe(en.appCenter.tileName("Board", "Helper", en.appCenter.running));
  expect(tileNamed("notes")).toBe(en.appCenter.tileName("Notes", "Helper", en.appCenter.running));

  // Away from the App Center its page is gone, the apps are not, and none is on screen.
  await click([...document.querySelectorAll("a")].find((a) => a.textContent === "Sidebar chat")!);
  expect(whereIs(router)).toBe("/chat");
  expect(grid()).toBeNull();
  expect([board.isConnected, notes.isConnected]).toEqual([true, true]);
  expect([reachable(board), reachable(notes)]).toEqual([false, false]);

  await run(() => router.navigate("/apps"));
  await until(() => grid() !== null);
  await click(tileButton(key("notes")));
  expect(frameOf("Notes")).toBe(notes);
  expect([reachable(board), reachable(notes)]).toEqual([false, true]);
});

it("lists the running apps outside the App Center and brings one back over the page it was on", async () => {
  const { router } = await open([workbench("board"), workbench("notes")]);
  expect(listed()).toEqual([]);
  await click(tileButton(key("board")));
  await until(() => frameOf("Board") !== null);
  const frame = frameOf("Board")!;
  expect(listed()).toEqual(["Board (in front)"]);
  await click(buttonIn(windowOf("Board")!, en.appCenter.windowMinimize));
  await click([...document.querySelectorAll("a")].find((a) => a.textContent === "Sidebar chat")!);
  expect(listed()).toEqual(["Board"]);

  await click(button("Board"));
  expect(whereIs(router)).toBe(`/apps?app=${encodeURIComponent(key("board"))}`);
  expect(frameOf("Board")).toBe(frame);
  expect(reachable(frame)).toBe(true);
  expect(listed()).toEqual(["Board (in front)"]);

  await click(buttonIn(windowOf("Board")!, en.appCenter.windowMinimize));
  expect(whereIs(router)).toBe("/chat");
  expect(frame.isConnected).toBe(true);
  expect(listed()).toEqual(["Board"]);
});

it("says how many apps of a folder are running, on the folder's tile", async () => {
  const layout: AppCenterLayout = {
    v: 1,
    items: [{ type: "folder", id: "fwork", name: "Work", apps: [key("board"), key("notes")] }],
  };
  await open([workbench("board"), workbench("notes")], { layout });
  expect(folderButton("Work").getAttribute("aria-label")).toBe(
    en.appCenter.folderName("Work", 2, 0),
  );
  await click(folderButton("Work"));
  await click(
    topDialog().querySelector<HTMLButtonElement>(`li[data-app="${key("board")}"] button`)!,
  );
  await until(() => frameOf("Board") !== null);
  await click(buttonIn(windowOf("Board")!, en.appCenter.windowMinimize));
  expect(folderButton("Work").getAttribute("aria-label")).toBe(
    en.appCenter.folderName("Work", 2, 1),
  );
});

it("ends the apps of a Project when the viewer switches to another", async () => {
  await open([workbench("board")], { otherProject: true });
  await click(tileButton(key("board")));
  await until(() => frameOf("Board") !== null);
  const frame = frameOf("Board")!;
  await click(buttonIn(windowOf("Board")!, en.appCenter.windowMinimize));
  expect(frame.isConnected).toBe(true);

  await click(button("Switch Project"));
  expect(frame.isConnected).toBe(false);
});

it("opens an app full screen from its menu, carrying the way back to the App Center", async () => {
  const { router } = await open([workbench("board", { appCenter: { show: true, tab: "main" } })]);
  await rightClick(tileButton(key("board")));
  await click(menuItem(en.appCenter.menu.openFullScreen));
  expect(whereIs(router)).toBe(`/app/${PROJECT_ID}/${AGENT_ID}/board/main`);
  expect(router.state.location.state).toEqual({ returnTo: "/apps" });
});

it("opens the Agent's Workbenches sub-page from a tile's View in agent settings", async () => {
  const { router } = await open([workbench("board")]);
  await rightClick(tileButton(key("board")));
  await click(menuItem(en.appCenter.menu.viewInSettings));
  expect(whereIs(router)).toBe(`/agents/${AGENT_ID}?tab=workbenches`);
});

it("does not open a building app, and turns it live when the server says it loaded", async () => {
  const { server, router } = await open([workbench("board")], { building: ["board"] });
  expect(item(key("board")).dataset["build"]).toBe("building");
  expect(tileButton(key("board")).getAttribute("aria-disabled")).toBe("true");
  await click(tileButton(key("board")));
  expect(whereIs(router)).toBe("/apps");
  await rightClick(tileButton(key("board")));
  expect(menuItem(en.appCenter.menu.open).disabled).toBe(true);
  expect(menuItem(en.appCenter.menu.openFullScreen).disabled).toBe(true);
  await pressEscape();

  server.setBuilding("board", false);
  await news(WORKBENCH_UPDATED_EVENT);
  await until(() => item(key("board")).dataset["build"] === "ready");
  await click(tileButton(key("board")));
  expect(whereIs(router)).toBe(`/apps?app=${encodeURIComponent(key("board"))}`);
});

it("turns a tile to building when the server starts loading its workbench", async () => {
  const { server } = await open([workbench("board")]);
  expect(item(key("board")).dataset["build"]).toBe("ready");
  server.setBuilding("board", true);
  await news(WORKBENCH_BUILDING_EVENT);
  await until(() => item(key("board")).dataset["build"] === "building");
});

it("still opens a failed app, and its menu shows the recorded error", async () => {
  const { router } = await open([
    workbench("board", { error: "index.ts:1:1 TS1005 ';' expected" }),
  ]);
  expect(tileButton(key("board")).getAttribute("aria-label")).toBe(
    en.appCenter.tileName("Board", "Helper", en.appCenter.broken),
  );
  await rightClick(tileButton(key("board")));
  await click(menuItem(en.appCenter.menu.showError));
  expect(topDialog().textContent).toContain("index.ts:1:1 TS1005 ';' expected");
  await click(button(en.common.close));
  await click(tileButton(key("board")));
  expect(whereIs(router)).toBe(`/apps?app=${encodeURIComponent(key("board"))}`);
});

it("reorders by dragging a tile beside another, and stores the order as the viewer's", async () => {
  const { server } = await open([workbench("board"), workbench("notes"), workbench("todo")]);
  // The trailing quarter of the last tile: after it.
  await drag(item(key("board")), item(key("todo")), 90);
  expect(order()).toEqual([key("notes"), key("todo"), key("board")]);
  expect(server.appCenterLayout()).toEqual({
    v: 1,
    items: [
      { type: "app", app: key("notes") },
      { type: "app", app: key("todo") },
      { type: "app", app: key("board") },
    ],
  });
});

it("reorders from the menu, and a refused write puts the grid back to what is stored", async () => {
  const { server } = await open([workbench("board"), workbench("notes")]);
  await rightClick(tileButton(key("notes")));
  // The first tile cannot go further forward.
  await click(menuItem(en.appCenter.menu.moveForward));
  expect(order()).toEqual([key("notes"), key("board")]);

  server.refuseNext(500, "internal", "disk full");
  await rightClick(tileButton(key("notes")));
  await click(menuItem(en.appCenter.menu.moveBackward));
  await until(() => order()[0] === key("notes"));
  expect(server.appCenterLayout()?.items[0]).toEqual({ type: "app", app: key("notes") });
});

it("makes a folder by dropping a tile onto another, then renames and ungroups it", async () => {
  const { server } = await open([workbench("board"), workbench("notes"), workbench("todo")]);
  // The middle of a tile: into it.
  await drag(item(key("todo")), item(key("board")), 50);
  expect(order()).toEqual([`folder:${en.appCenter.newFolder}`, key("notes")]);

  await rightClick(folderButton(en.appCenter.newFolder));
  await click(menuItem(en.appCenter.menu.rename));
  await type(topDialog().querySelector("input")!, "  Daily  ");
  await click(button(en.common.save));
  expect(order()).toEqual(["folder:Daily", key("notes")]);
  expect(server.appCenterLayout()?.items[0]).toMatchObject({
    type: "folder",
    name: "Daily",
    apps: [key("board"), key("todo")],
  });

  await rightClick(folderButton("Daily"));
  await click(menuItem(en.appCenter.menu.dissolve));
  expect(order()).toEqual([key("board"), key("todo"), key("notes")]);
});

it("makes a folder from the keyboard with Move to…, and opens it as a panel over the grid", async () => {
  await open([workbench("board"), workbench("notes")]);
  await press(tileButton(key("notes")), { key: "F10", shiftKey: true });
  await click(menuItem(en.appCenter.menu.moveTo));
  // The second page of the same menu: back, then the apps it can make a new folder with.
  expect(spoken(document.activeElement!)).toBe(en.appCenter.menu.back);
  await click(menuItem("Board"));
  expect(order()).toEqual([`folder:${en.appCenter.newFolder}`]);

  await click(folderButton(en.appCenter.newFolder));
  const panel = topDialog();
  // The dialog is named by its heading, the folder's name.
  expect(document.getElementById(panel.getAttribute("aria-labelledby")!)?.textContent).toBe(
    en.appCenter.newFolder,
  );
  expect(
    [...panel.querySelectorAll("li[data-app]")].map((li) => (li as HTMLElement).dataset["app"]),
  ).toEqual([key("board"), key("notes")]);

  // Dragged out onto the backdrop, an app leaves the folder, which keeps its one app.
  await dragOut(key("notes"));
  expect(order()).toEqual([`folder:${en.appCenter.newFolder}`, key("notes")]);
  expect(document.querySelector(".ui-scrim")).toBeNull();

  // The last app out leaves no folder behind.
  await click(folderButton(en.appCenter.newFolder));
  await dragOut(key("board"));
  expect(order()).toEqual([key("board"), key("notes")]);
});

it("makes a folder of the apps checked in the header's New folder, at the first one's place", async () => {
  const { server } = await open([workbench("board"), workbench("notes"), workbench("todo")]);
  await click(button(en.appCenter.newFolderAction));
  const dialog = topDialog();
  const name = dialog.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
  // The starting name is selected, so typing replaces it.
  expect(name.value).toBe(en.appCenter.newFolder);
  expect([name.selectionStart, name.selectionEnd]).toEqual([0, name.value.length]);
  expect(checkedApps()).toEqual([]);
  expect(buttonIn(dialog, en.appCenter.newFolderCreate).disabled).toBe(true);

  await click(appBox("Todo"));
  await click(appBox("Notes"));
  await type(name, "Daily");
  await click(buttonIn(dialog, en.appCenter.newFolderCreate));
  expect(order()).toEqual([key("board"), "folder:Daily"]);
  expect(server.appCenterLayout()?.items).toEqual([
    { type: "app", app: key("board") },
    { type: "folder", id: expect.any(String), name: "Daily", apps: [key("notes"), key("todo")] },
  ]);
});

it("opens New folder… from a tile's Move to… with that app checked, and keeps a folder of one", async () => {
  const layout: AppCenterLayout = {
    v: 1,
    items: [{ type: "folder", id: "fwork", name: "Work", apps: [key("todo"), key("board")] }],
  };
  const { server } = await open([workbench("board"), workbench("notes"), workbench("todo")], {
    layout,
  });
  await rightClick(tileButton(key("notes")));
  await click(menuItem(en.appCenter.menu.moveTo));
  await click(menuItem(en.appCenter.menu.newFolder));
  expect(checkedApps()).toEqual(["Notes"]);
  // An app in a folder says which; picking it takes it out of there.
  expect(appBox("Todo").closest("label")?.textContent).toContain(
    en.appCenter.newFolderInFolder("Work"),
  );
  await click(buttonIn(topDialog(), en.appCenter.newFolderCreate));
  expect(order()).toEqual(["folder:Work", `folder:${en.appCenter.newFolder}`]);
  expect(server.appCenterLayout()?.items[1]).toMatchObject({
    type: "folder",
    name: en.appCenter.newFolder,
    apps: [key("notes")],
  });
});

it("asks before restoring the default order, and only the confirmation clears the layout", async () => {
  const layout: AppCenterLayout = {
    v: 1,
    items: [
      { type: "app", app: key("notes") },
      { type: "app", app: key("board") },
    ],
  };
  const { server } = await open([workbench("board"), workbench("notes")], { layout });
  expect(order()).toEqual([key("notes"), key("board")]);
  // The grid's empty space has a menu of its own.
  await rightClick(grid()!.parentElement!);
  await click(menuItem(en.appCenter.menu.restoreDefault));
  expect(topDialog().textContent).toContain(en.appCenter.restoreBody);
  await click(button(en.common.cancel));
  expect(server.appCenterLayout()).toEqual(layout);

  await rightClick(grid()!.parentElement!);
  await click(menuItem(en.appCenter.menu.restoreDefault));
  await click(button(en.appCenter.restoreConfirm));
  expect(server.appCenterLayout()).toBeNull();
  expect(order()).toEqual([key("board"), key("notes")]);
});

it("opens a tile's menu on right-click, Shift+F10 and the ContextMenu key; Esc closes it and hands focus back", async () => {
  await open([workbench("board")]);
  const tile = tileButton(key("board"));
  expect(await rightClick(tile, 120, 80)).toBe(true);
  expect(menu()?.getAttribute("aria-label")).toBe("Board");
  await pressEscape();
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(tile);

  await press(tile, { key: "F10", shiftKey: true });
  expect(menu()).not.toBeNull();
  await pressEscape();
  await press(tile, { key: "ContextMenu" });
  expect(menu()).not.toBeNull();
  await pressEscape();
  expect(menu()).toBeNull();

  // Outside the App Center the browser's own menu stays.
  expect(await rightClick(document.body)).toBe(false);
});

it("with nothing shown, explains workbenches and offers to have one built for the App Center", async () => {
  await open([workbench("hidden", { appCenter: { show: false } })]);
  expect(document.body.textContent).toContain(en.appCenter.empty);
  await click(button(en.aiCreate.withAi));
  // The full prompt the dialog previews ends in the fixed request for an App Center workbench.
  expect(topDialog().textContent).toContain(en.appCenter.aiCreateTail);
});
