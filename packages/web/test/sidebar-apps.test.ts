/** @vitest-environment jsdom */
/**
 * The sidebar's app list (features/session-list/main-sidebar-apps.tsx): the apps of the Agent the
 * page works under, then any other app still running, each opened in the App Center's window over
 * the main area. One fake server behind the app, the real list, App Center page and windows.
 *
 * - Given the current Agent's workbenches, the list has a row for each one its sidebar shows, and
 *   none for one hidden from the sidebar or without a page; with nothing to list and nothing
 *   running, the group is not there.
 * - Given a move to another Agent's conversation while the first one's list is still being read,
 *   the list shows the other Agent's apps, and the first one's late answer never lands.
 * - A row opens the app's window over the conversation the reader is on, and is lit while the
 *   window is in front; Close ends the app and returns to that conversation.
 * - Minimize returns to the conversation with the app still running: the row says so, and brings
 *   back the very same frame.
 * - A running app of another Agent is listed after the Agent's own, says whose it is, and has no
 *   "Remove from sidebar" (only the Agent's setting lists a row).
 * - "Remove from sidebar" writes the installation's setting, and the row leaves.
 * - A workbench the Agent adds shows up on the server's news, without a reload.
 * - A conversation on a machine lists that machine's apps, read from the machine, and its row
 *   opens the window at the machine's key; with the window over the conversation, the list keeps
 *   the machine's apps, the open one lit. Left for a page that names no Agent, the list keeps
 *   them while the current Agent is that Agent, and follows the current Agent once it is another.
 * - An app hidden from the App Center keeps running through a visit to the App Center, whose
 *   list lacks it; an app whose workbench is removed ends.
 * - A workbench with two pages switches between them in the window's title bar.
 */
import { createElement as h, useEffect } from "react";
import { afterEach, expect, it } from "vitest";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import * as api from "../src/api/endpoints";
import { AppCenterPage } from "../src/features/app-center/app-center-page";
import { AppCenterWindows } from "../src/features/app-center/app-center-windows";
import { MainSidebarApps } from "../src/features/session-list/main-sidebar-apps";
import { publishPageAgent } from "../src/lib/page-agent";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { WORKBENCH_UPDATED_EVENT } from "../src/lib/workbench-tabs";
import { useProject } from "../src/state/project";
import { ThemeProvider } from "../src/state/theme";
import {
  AGENT_ID,
  PROJECT_ID,
  agentServer,
  buttonIn,
  mountAgentApp,
  whereIs,
} from "./helpers/agent-app";
import { button, click, menuItem, run, unmountAll } from "./helpers/dom";

const page = (id: string, key: string, title: string) => ({
  id: `${id}.${key}`,
  key,
  title,
  renderer: {
    iframe: {
      src: `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/workbenches/${id}/ui/${key}.html`,
    },
  },
});

const workbench = (id: string, over: Partial<WorkbenchInfo> = {}): WorkbenchInfo => ({
  id,
  name: id,
  version: "1.0.0",
  revision: "abcdef012345",
  uiRev: "0123456789ab",
  loadedAt: "2026-11-04T00:00:00Z",
  error: null,
  hints: [],
  tabs: [page(id, "main", id[0]!.toUpperCase() + id.slice(1))],
  appCenter: { show: true },
  ...over,
});

const key = (id: string, agentId = AGENT_ID) => `${agentId}/${id}`;

/** Makes another Agent the current one, as the new-chat picker does. */
function SwitchAgent() {
  const { setCurrentAgentId } = useProject();
  return h("button", { type: "button", onClick: () => setCurrentAgentId("second") }, "Switch");
}

/** A conversation of `agentId` on `machineId`: the chat page says which Agent for the list. */
function Conversation({ agentId, machineId }: { agentId: string; machineId: string | null }) {
  const projectId = useProject().currentProject?.projectId ?? null;
  useEffect(
    () => (projectId === null ? undefined : publishPageAgent({ projectId, agentId, machineId })),
    [projectId, agentId, machineId],
  );
  return h("p", null, `Conversation of ${agentId}`);
}
const HERE = "/chat/here";

async function open(
  workbenches: WorkbenchInfo[],
  options: { second?: WorkbenchInfo[]; at?: string } = {},
) {
  setActiveStrings(en);
  const server = agentServer(undefined, {
    workbenches,
    moreAgents: [{ agentId: "second", name: "Second" }],
    otherWorkbenches: { second: options.second ?? [] },
    machines: [{ machineId: "m1", alias: "box", agents: [AGENT_ID] }],
  });
  const router = await mountAgentApp(h(ThemeProvider, null, h(AppCenterPage)), {
    route: "/apps",
    at: options.at ?? HERE,
    extra: [
      { path: HERE, element: h(Conversation, { agentId: AGENT_ID, machineId: null }) },
      { path: "/chat/second", element: h(Conversation, { agentId: "second", machineId: null }) },
      {
        path: "/chat/on-machine",
        element: h(Conversation, { agentId: AGENT_ID, machineId: "m1" }),
      },
    ],
    // Beside every page, as the shell mounts them: the windows' layer and the sidebar.
    layers: [h(ThemeProvider, null, h(AppCenterWindows)), h(MainSidebarApps), h(SwitchAgent)],
  });
  current = router;
  return { server, router };
}

/** Settles, letting real time pass too (a list gathers workbench news for a moment). */
let current: { state: { location: { pathname: string; search: string } } } | null = null;
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (ready()) return;
    await run(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw new Error(
    `the page never reached the awaited state: ${current === null ? "" : whereIs(current)} ${JSON.stringify(rows())} ${document.body.textContent?.slice(0, 300)}`,
  );
}

/** What a reader reads of an element: its text outside `aria-hidden` subtrees (a letter tile). */
function spoken(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") return "";
  return [...node.childNodes].map(spoken).join(" ").replace(/\s+/g, " ").trim();
}

const group = () => document.querySelector<HTMLElement>(`ul[aria-label="${en.sidebarApps.title}"]`);
const row = (appKey: string) =>
  document.querySelector<HTMLButtonElement>(`[data-app-row="${appKey}"]`);
/** The rows in order, each as its name, with "(lit)" on the one whose window is in front. */
const rows = () =>
  [...(group()?.querySelectorAll<HTMLButtonElement>("[data-app-row]") ?? [])].map(
    (b) =>
      `${b.getAttribute("aria-label") ?? spoken(b)}${b.getAttribute("aria-current") === "page" ? " (lit)" : ""}`,
  );
/** Opens a row's menu from its "more" button. */
const openMenu = (appKey: string) =>
  click(row(appKey)!.closest("li")!.querySelector(`button[aria-label="${en.chat.moreActions}"]`)!);
const menuLabels = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].map((item) =>
    item.textContent?.trim(),
  );
const windowOf = (title: string) =>
  document.querySelector<HTMLElement>(`section[aria-label="${title}"]`);
const frameOf = (title: string) => windowOf(title)?.querySelector("iframe") ?? null;
/** Whether the element is on screen and reachable: no window around it is hidden. */
const reachable = (el: Element) => el.closest("[data-window]")?.hasAttribute("inert") === false;
const news = (agentId = AGENT_ID) =>
  run(() =>
    window.dispatchEvent(
      new CustomEvent(WORKBENCH_UPDATED_EVENT, { detail: { projectId: PROJECT_ID, agentId } }),
    ),
  );
const running = (title: string, agent: string | null = null) =>
  en.sidebarApps.rowName(title, agent, en.appCenter.running);

afterEach(async () => {
  await unmountAll();
  setActiveStrings(zh);
  // The current Agent is remembered per browser: a switch in one scenario must not open the next.
  localStorage.clear();
});

it("lists the apps the current Agent's sidebar shows, and is not there with none", async () => {
  await open([
    workbench("board"),
    workbench("quiet", { showInSidebar: false }),
    workbench("headless", { tabs: [] }),
  ]);
  await until(() => group() !== null);
  expect(rows()).toEqual(["Board"]);
  await unmountAll();

  await open([workbench("quiet", { showInSidebar: false })]);
  await news();
  expect(group()).toBeNull();
  expect(document.body.textContent).not.toContain(en.sidebarApps.title);
});

it("follows a move to another Agent's conversation, and drops the late answer for the one left", async () => {
  const { server, router } = await open([workbench("board")], { second: [workbench("notes")] });
  await until(() => rows().length === 1);
  const slow = server.holdNext(null, new RegExp(`/agents/${AGENT_ID}/workbenches$`));
  await news();

  await run(() => router.navigate("/chat/second"));
  await until(() => rows().includes("Notes"));
  slow.release();
  await run(() => new Promise((resolve) => setTimeout(resolve, 30)));
  expect(rows()).toEqual(["Notes"]);
});

it("opens an app's window over the conversation, lit while in front, and Close returns there", async () => {
  const { router } = await open([workbench("board")]);
  await until(() => row(key("board")) !== null);

  await click(row(key("board"))!);
  expect(whereIs(router)).toBe(`/apps?app=${encodeURIComponent(key("board"))}`);
  await until(() => frameOf("Board") !== null);
  expect(reachable(frameOf("Board")!)).toBe(true);
  expect(rows()).toEqual([`${running("Board")} (lit)`]);

  await click(buttonIn(windowOf("Board")!, en.appCenter.windowClose));
  expect(whereIs(router)).toBe(HERE);
  expect(windowOf("Board")).toBeNull();
  expect(rows()).toEqual(["Board"]);
});

it("minimizes to the conversation with the app running, and its row brings back the same frame", async () => {
  const { router } = await open([workbench("board")]);
  await until(() => row(key("board")) !== null);
  await click(row(key("board"))!);
  await until(() => frameOf("Board") !== null);
  const frame = frameOf("Board")!;

  await click(buttonIn(windowOf("Board")!, en.appCenter.windowMinimize));
  expect(whereIs(router)).toBe(HERE);
  expect(frame.isConnected).toBe(true);
  expect(reachable(frame)).toBe(false);
  expect(rows()).toEqual([running("Board")]);

  await click(row(key("board"))!);
  expect(frameOf("Board")).toBe(frame);
  expect(reachable(frame)).toBe(true);
});

it("lists another Agent's running app after the Agent's own, says whose it is, with nothing to remove", async () => {
  const { router } = await open([workbench("board")], { second: [workbench("notes")] });
  await until(() => row(key("board")) !== null);
  await click(row(key("board"))!);
  await until(() => frameOf("Board") !== null);
  await click(buttonIn(windowOf("Board")!, en.appCenter.windowMinimize));

  await run(() => router.navigate("/chat/second"));
  await until(() => rows().includes("Notes"));
  expect(rows()).toEqual(["Notes", running("Board", "Helper")]);
  await openMenu(key("board"));
  expect(menuLabels()).toEqual([en.sidebarApps.open, en.sidebarApps.viewInSettings]);
});

it("removes a row from the sidebar through the installation's setting", async () => {
  const { server } = await open([workbench("board"), workbench("notes")]);
  await until(() => rows().length === 2);
  await openMenu(key("notes"));
  expect(menuLabels()).toEqual([
    en.sidebarApps.open,
    en.sidebarApps.removeFromSidebar,
    en.sidebarApps.viewInSettings,
  ]);

  await click(menuItem(en.sidebarApps.removeFromSidebar));
  await until(() => rows().length === 1);
  expect(rows()).toEqual(["Board"]);
  expect(
    server.writes(`/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/workbenches/notes/sidebar`),
  ).toHaveLength(1);
});

it("shows a workbench the Agent adds on the server's news, without a reload", async () => {
  const { server } = await open([workbench("board")]);
  await until(() => rows().length === 1);
  server.putWorkbench(workbench("notes"));
  await news();
  await until(() => rows().length === 2);
  expect(rows()).toEqual(["Board", "Notes"]);
});

it("lists a machine conversation's apps from the machine, and opens them at its key", async () => {
  const { server, router } = await open([workbench("board")], { at: "/chat/on-machine" });
  await until(() => row(`m1:${key("board")}`) !== null);
  expect(
    server
      .requests()
      .some((r) => r.machine === "m1" && r.path.endsWith(`/agents/${AGENT_ID}/workbenches`)),
  ).toBe(true);

  await click(row(`m1:${key("board")}`)!);
  expect(whereIs(router)).toBe(`/apps?app=${encodeURIComponent(`m1:${key("board")}`)}`);
  await until(() => frameOf("Board") !== null);
  expect(rows()).toEqual([`${running("Board")} (lit)`]);
  expect(frameOf("Board")!.getAttribute("src")).toMatch(
    new RegExp(`^/server/m1/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/workbenches/board/ui/`),
  );
});

it("keeps a machine conversation's apps on a page that names no Agent, until the current Agent is another", async () => {
  const { router } = await open([workbench("board")], {
    at: "/chat/on-machine",
    second: [workbench("notes")],
  });
  await until(() => row(`m1:${key("board")}`) !== null);

  await run(() => router.navigate("/agents"));
  expect(row(`m1:${key("board")}`)).not.toBeNull();

  await click(button("Switch"));
  await until(() => rows().includes("Notes"));
  expect(rows()).toEqual(["Notes"]);
});

it("keeps an app hidden from the App Center running through a visit there, and ends one whose workbench is removed", async () => {
  const { server, router } = await open([
    workbench("desk", { appCenter: { show: false } }),
    workbench("board"),
  ]);
  await until(() => rows().length === 2);
  for (const [id, title] of [
    ["desk", "Desk"],
    ["board", "Board"],
  ] as const) {
    await click(row(key(id))!);
    await until(() => frameOf(title) !== null);
    await click(buttonIn(windowOf(title)!, en.appCenter.windowMinimize));
  }
  const desk = frameOf("Desk")!;

  await run(() => router.navigate("/apps"));
  await until(() => document.querySelector(`li[data-app="${key("board")}"]`) !== null);
  expect(document.querySelector(`li[data-app="${key("desk")}"]`)).toBeNull();
  expect(desk.isConnected).toBe(true);

  await run(() => router.navigate(HERE));
  await run(() => api.removeWorkbench(PROJECT_ID, AGENT_ID, "board", null));
  await news();
  await until(() => frameOf("Board") === null);
  expect(desk.isConnected).toBe(true);
  expect(rows()).toEqual([running("Desk")]);
});

it("switches a two-page app's pages in the window's title bar", async () => {
  await open([
    workbench("board", {
      tabs: [page("board", "clear", "Clear"), page("board", "solid", "Solid")],
    }),
  ]);
  await until(() => row(key("board")) !== null);
  await click(row(key("board"))!);
  await until(() => frameOf("Clear") !== null);
  const bar = windowOf("Clear")!;
  expect(buttonIn(bar, "Clear").getAttribute("aria-pressed")).toBe("true");

  await click(buttonIn(bar, "Solid"));
  expect(windowOf("Clear")!.querySelector("iframe")!.getAttribute("title")).toBe("Solid");
  expect(buttonIn(bar, "Solid").getAttribute("aria-pressed")).toBe("true");
});
