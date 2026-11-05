/** @vitest-environment jsdom */
/**
 * The App Center page (/apps): the Project's home screen of workbench shortcuts.
 *
 * - Given shown workbenches, the page shows one tile each in the server's order, with the title
 *   and the Agent's name and no id; a tile opens the workbench's full page, carrying the way
 *   back to the App Center.
 * - Given a workbench whose current files do not load, its tile says so to a screen reader and
 *   on hover, and still opens.
 * - Given nothing shown, the page says what a workbench is, and its one button opens the
 *   "Create with AI" dialog, whose prompt asks for a workbench in the App Center.
 * - Given a workbench of the Project loads while the page is open, its tile appears without a
 *   reload; news about another Project reads nothing.
 */
import { createElement as h } from "react";
import { afterEach, expect, it } from "vitest";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { AppCenterPage } from "../src/features/app-center/app-center-page";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { WORKBENCH_UPDATED_EVENT } from "../src/lib/workbench-tabs";
import {
  AGENT_ID,
  PROJECT_ID,
  agentServer,
  mountAgentApp,
  topDialog,
  whereIs,
} from "./helpers/agent-app";
import { button, click, run, settle, unmountAll, waitFor } from "./helpers/dom";

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

async function open(workbenches: WorkbenchInfo[]) {
  setActiveStrings(en);
  const server = agentServer(undefined, { workbenches });
  const router = await mountAgentApp(h(AppCenterPage), {
    route: "/apps",
    at: "/apps",
    extra: [
      { path: "/app/:projectId/:agentId/:workbenchId", element: h("p", null, "Workbench page") },
      {
        path: "/app/:projectId/:agentId/:workbenchId/:tabKey",
        element: h("p", null, "Workbench page"),
      },
    ],
  });
  return { server, router };
}

const tiles = () => [
  ...document.querySelectorAll<HTMLAnchorElement>(`ul[aria-label="${en.appCenter.title}"] a`),
];

/** What a screen reader reads of an element: its text outside `aria-hidden` subtrees. */
function spoken(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") return "";
  return [...node.childNodes].map(spoken).join(" ").replace(/\s+/g, " ").trim();
}

afterEach(async () => {
  await unmountAll();
  setActiveStrings(zh);
});

it("shows one tile per shown workbench in the server's order, and a tile opens its full page with the way back", async () => {
  const { router } = await open([
    workbench("board", { appCenter: { show: true, tab: "main" } }),
    workbench("notes"),
    workbench("hidden", { appCenter: { show: false } }),
  ]);
  await waitFor(() => tiles().length === 2);
  // The tile names the app and its Agent; the ids are the address, never the text.
  expect(tiles().map(spoken)).toEqual(["Board Helper", "Notes Helper"]);

  await click(tiles()[0]!);
  expect(whereIs(router)).toBe(`/app/${PROJECT_ID}/${AGENT_ID}/board/main`);
  expect(router.state.location.state).toEqual({ returnTo: "/apps" });
});

it("marks a workbench that does not load, and still opens it", async () => {
  const { router } = await open([workbench("board", { error: "index.ts:1:1 TS1005" })]);
  await waitFor(() => tiles().length === 1);
  const [tile] = tiles();
  expect(spoken(tile!)).toBe(`Board Helper ${en.appCenter.broken}`);
  expect(tile!.getAttribute("data-tooltip")).toBe(en.appCenter.broken);
  await click(tile!);
  expect(whereIs(router)).toBe(`/app/${PROJECT_ID}/${AGENT_ID}/board`);
});

it("with nothing shown, explains workbenches and offers to have one built for the App Center", async () => {
  await open([workbench("hidden", { appCenter: { show: false } })]);
  await waitFor(() => document.body.textContent?.includes(en.appCenter.emptyTitle) === true);
  expect(document.body.textContent).toContain(en.appCenter.empty);
  await click(button(en.aiCreate.withAi));
  // The full prompt the dialog previews ends in the fixed request for an App Center workbench.
  expect(topDialog().textContent).toContain(en.appCenter.aiCreateTail);
});

it("reads the list again when a workbench of this Project loads, and not for another Project", async () => {
  const { server } = await open([]);
  await waitFor(() => document.body.textContent?.includes(en.appCenter.emptyTitle) === true);
  // The Agent list arriving reads the list once more; that settles before the news below.
  await waitFor(() =>
    server.requests().some((r) => r.path === `/api/projects/${PROJECT_ID}/agents`),
  );
  for (let i = 0; i < 3; i++) await settle();
  const reads = () =>
    server.requests().filter((r) => r.path === `/api/projects/${PROJECT_ID}/app-center`).length;
  const before = reads();

  server.putWorkbench(workbench("board"));
  await run(() =>
    window.dispatchEvent(
      new CustomEvent(WORKBENCH_UPDATED_EVENT, {
        detail: { projectId: "elsewhere", agentId: AGENT_ID },
      }),
    ),
  );
  expect(reads()).toBe(before);
  expect(tiles()).toEqual([]);

  await run(() =>
    window.dispatchEvent(
      new CustomEvent(WORKBENCH_UPDATED_EVENT, {
        detail: { projectId: PROJECT_ID, agentId: AGENT_ID },
      }),
    ),
  );
  await waitFor(() => tiles().length === 1);
  expect(tiles()[0]!.textContent).toContain("Board");
});
