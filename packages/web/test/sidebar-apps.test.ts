/** @vitest-environment jsdom */
/** The real window host and Apps group share one page workspace. */
import { createElement as h, useEffect } from "react";
import { afterEach, expect, it } from "vitest";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import * as api from "../src/api/endpoints";
import { AppCenterPage } from "../src/features/app-center/app-center-page";
import { WorkspaceWindows, pageAction } from "./helpers/workspace-windows";
import { useRestoreApp } from "../src/lib/running-apps";
import { shortcutOfWorkbench } from "../src/lib/workbench-shortcut";
import { locatedAppKey } from "../src/lib/app-center-path";
import { publishPageAgent } from "../src/lib/page-agent";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { WORKBENCH_UPDATED_EVENT } from "../src/lib/workbench-tabs";
import { useProject } from "../src/state/project";
import { SYSTEM_APP_PAGES } from "./helpers/system-app-pages";
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

/** Open a fixture workbench through the same action used by Agent settings. */
function Launchers({ items }: { items: WorkbenchInfo[] }) {
  const restore = useRestoreApp();
  return items.flatMap((item) =>
    [null, "m1"].map((machine) => {
      const id = locatedAppKey(AGENT_ID, item.id, machine);
      return h(
        "button",
        {
          key: id,
          onClick: () =>
            restore(
              id,
              shortcutOfWorkbench(
                PROJECT_ID,
                { agentId: AGENT_ID, agentName: "Helper" },
                item,
                machine,
              ),
            ),
        },
        "Launch " + id,
      );
    }),
  );
}
const launch = (id: string) => click(button("Launch " + id));

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
  options: { second?: WorkbenchInfo[]; at?: string; admin?: boolean } = {},
) {
  setActiveStrings(en);
  const server = agentServer(undefined, {
    workbenches,
    admin: options.admin ?? true,
    moreAgents: [{ agentId: "second", name: "Second" }],
    otherWorkbenches: { second: options.second ?? [] },
    machines: [{ machineId: "m1", alias: "box", agents: [AGENT_ID] }],
  });
  const router = await mountAgentApp(h(ThemeProvider, null, h(AppCenterPage)), {
    route: "/apps",
    at: options.at ?? HERE,
    pages: SYSTEM_APP_PAGES,
    extra: [
      ...SYSTEM_APP_PAGES.filter((p) => p.app || p.key === "benchmark-detail").map((p) => ({
        path: p.path,
        element: h("p", null, p.key),
      })),
      { path: HERE, element: h(Conversation, { agentId: AGENT_ID, machineId: null }) },
      { path: "/chat/second", element: h(Conversation, { agentId: "second", machineId: null }) },
      {
        path: "/chat/on-machine",
        element: h(Conversation, { agentId: AGENT_ID, machineId: "m1" }),
      },
    ],
    // Beside every page, as the shell mounts them: the windows' layer and the sidebar.
    layers: [
      h(ThemeProvider, null, h(WorkspaceWindows)),
      h(SwitchAgent),
      h(Launchers, { items: workbenches }),
    ],
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
  group()?.querySelector<HTMLButtonElement>(`[data-app-row="${appKey}"]`) ?? null;
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

it("leaves installed workbenches out of Apps until this window opens them", async () => {
  const { server, router } = await open(
    [
      workbench("board"),
      workbench("quiet", { showInSidebar: false }),
      workbench("headless", { tabs: [] }),
    ],
    { second: [workbench("notes")] },
  );
  expect(group()).toBeNull();
  server.putWorkbench(workbench("newly-installed"));
  await news();
  await run(() => router.navigate("/chat/second"));
  expect(group()).toBeNull();
  expect(server.writes().filter((request) => request.path.endsWith("/sidebar"))).toEqual([]);
});

it("opens an app's window over the conversation, lit while in front, and Close returns there", async () => {
  const { router } = await open([workbench("board")]);
  await launch(key("board"));
  expect(whereIs(router)).toBe(`/apps?app=${encodeURIComponent(key("board"))}`);
  await until(() => frameOf("Board") !== null);
  expect(reachable(frameOf("Board")!)).toBe(true);
  expect(rows()).toEqual([`${running("Board")} (lit)`]);

  await pageAction("Board", en.appCenter.windowClose);
  expect(whereIs(router)).toBe(HERE);
  expect(windowOf("Board")).toBeNull();
  expect(group()).toBeNull();
});

it("minimizes to the conversation with the app running, and its row brings back the same frame", async () => {
  const { router } = await open([workbench("board")]);
  await launch(key("board"));
  await until(() => frameOf("Board") !== null);
  const frame = frameOf("Board")!;

  await pageAction("Board", en.appCenter.windowMinimize);
  expect(whereIs(router)).toBe(HERE);
  expect(frame.isConnected).toBe(true);
  expect(reachable(frame)).toBe(false);
  expect(rows()).toEqual([running("Board")]);

  await click(row(key("board"))!);
  expect(frameOf("Board")).toBe(frame);
  expect(reachable(frame)).toBe(true);
});

it("minimizes a restored workspace window back to its remaining conversation", async () => {
  const { router } = await open([workbench("board")]);
  await launch(key("board"));
  await until(() => frameOf("Board") !== null);
  const frame = frameOf("Board");
  await pageAction("Board", en.appCenter.windowMinimize);
  await pageAction("Board", en.pageWorkspace.restore);
  await pageAction("Board", en.appCenter.windowMinimize);
  expect(whereIs(router)).toBe(HERE);
  expect(frame?.isConnected).toBe(true);
  await pageAction("Board", en.pageWorkspace.restore);
  await pageAction("Board", en.common.close);
  expect(whereIs(router)).toBe(HERE);
  expect(frame?.isConnected).toBe(false);
});

it("sorts the same open tabs by page order, name, and the most recent selection", async () => {
  await open([workbench("notes"), workbench("board")]);
  await launch(key("notes"));
  await until(() => row(key("notes")) !== null);
  await launch(key("board"));
  await until(() => row(key("board")) !== null);
  const order = () =>
    [...group()!.querySelectorAll("[data-app-row]")].map((el) => el.getAttribute("data-app-row"));
  const sort = async (label: string) => {
    await click(button(en.sidebarApps.sort));
    await click(menuItem(label));
  };
  expect(order()).toEqual([key("notes"), key("board")]);
  await sort(en.sidebarApps.order.name);
  expect(order()).toEqual([key("board"), key("notes")]);
  await sort(en.sidebarApps.order.recent);
  expect(order()).toEqual([key("board"), key("notes")]);
  await click(row(key("notes"))!);
  expect(order()).toEqual([key("notes"), key("board")]);
  await click(row(key("board"))!);
  expect(order()).toEqual([key("board"), key("notes")]);
  await sort(en.sidebarApps.order.default);
  expect(order()).toEqual([key("notes"), key("board")]);
});

it("keeps the open app when changing Agents and leaves the next Agent's unopened apps out", async () => {
  const { router } = await open([workbench("board")], { second: [workbench("notes")] });
  await launch(key("board"));
  await until(() => frameOf("Board") !== null);
  await pageAction("Board", en.appCenter.windowMinimize);

  await run(() => router.navigate("/chat/second"));
  await until(() => rows().includes(running("Board", "Helper")));
  expect(rows()).toEqual([running("Board", "Helper")]);
  await openMenu(key("board"));
  expect(menuLabels()).toEqual([
    en.pageWorkspace.restore,
    en.pageWorkspace.right,
    en.pageWorkspace.separate,
    en.appCenter.windowFullScreen,
    en.common.close,
    en.sidebarApps.viewInSettings,
  ]);
});

it("keeps remote and local pages with the same Agent and workbench ID distinct", async () => {
  const { router, server } = await open([workbench("board", { showInSidebar: false })], {
    at: "/chat/on-machine",
    second: [workbench("notes")],
  });
  const remote = "m1:" + key("board");
  expect(group()).toBeNull();
  await launch(remote);
  await until(() => row(remote) !== null && frameOf("Board") !== null);
  expect(whereIs(router)).toBe("/apps?app=" + encodeURIComponent(remote));
  expect(frameOf("Board")!.getAttribute("src")).toContain("/server/m1/");
  expect(row(remote)?.textContent).toContain("Board [SSH: box]");
  expect(row(remote)?.getAttribute("aria-label")).toContain("Board [SSH: box]");
  await pageAction("Board [SSH: box]", en.appCenter.windowMinimize);
  await launch(key("board"));
  await until(() => row(key("board")) !== null);
  await click(button("Switch"));
  expect(rows()).toHaveLength(2);
  await openMenu(remote);
  await click(menuItem(en.common.close));
  expect(row(remote)).toBeNull();
  expect(row(key("board"))).not.toBeNull();
  expect(server.writes().filter((request) => request.path.endsWith("/sidebar"))).toEqual([]);
});

it("keeps an app hidden from the App Center running through a visit there, and ends one whose workbench is removed", async () => {
  const { server, router } = await open([
    workbench("desk", { appCenter: { show: false } }),
    workbench("board"),
  ]);
  expect(group()).toBeNull();
  for (const [id, title] of [
    ["desk", "Desk"],
    ["board", "Board"],
  ] as const) {
    await launch(key(id));
    await until(() => frameOf(title) !== null);
    await pageAction(title, en.appCenter.windowMinimize);
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

it("switches subpages in a multi-page workbench", async () => {
  await open([
    workbench("board", {
      tabs: [page("board", "clear", "Clear"), page("board", "solid", "Solid")],
    }),
  ]);
  await launch(key("board"));
  await until(() => frameOf("Clear") !== null);
  const bar = windowOf("Clear")!;
  expect(buttonIn(bar, "Clear").getAttribute("aria-pressed")).toBe("true");

  await click(buttonIn(bar, "Solid"));
  expect(windowOf("Clear")!.querySelector("iframe")!.getAttribute("title")).toBe("Solid");
  expect(buttonIn(bar, "Solid").getAttribute("aria-pressed")).toBe("true");
});

it("lists each opened native app once in Apps and restores its last address", async () => {
  const { router } = await open([], { at: "/apps" });
  expect(group()).toBeNull();
  for (const name of ["models", "plugins", "machines", "usage", "benchmark"]) {
    await run(() => router.navigate("/" + name));
    expect(
      group()?.querySelector(`[data-app-row="system_agent/${name}"]`)?.getAttribute("aria-current"),
    ).toBe("page");
  }
  await run(() => router.navigate("/benchmark/sample?agentId=helper"));
  const app = "system_agent/benchmark";
  expect(group()?.querySelectorAll(`[data-app-row="${app}"]`)).toHaveLength(1);
  await openMenu(app);
  await click(menuItem(en.appCenter.windowMinimize));
  expect(whereIs(router)).not.toContain("/benchmark");
  expect(row(app)?.getAttribute("aria-current")).toBeNull();
  await openMenu(app);
  await click(menuItem(en.pageWorkspace.restore));
  expect(whereIs(router)).toBe("/benchmark/sample?agentId=helper");
  await openMenu(app);
  await click(menuItem(en.common.close));
  expect(row(app)).toBeNull();
  await run(() => router.navigate("/apps"));
  expect(document.querySelector(`li[data-app="${app}"]`)).not.toBeNull();
});

it("limits native Apps rows to the viewer's released pages even on direct navigation", async () => {
  const { router } = await open([], { at: "/machines", admin: false });
  expect(group()).toBeNull();
  await run(() => router.navigate("/models"));
  expect(row("system_agent/models")).not.toBeNull();
  expect(row("system_agent/machines")).toBeNull();
});
