/** @vitest-environment jsdom */
/**
 * The system apps' update dots (lib/system-app-notes.ts, PRFC-0033): the trails that end on a
 * system app's page have no nav row of their own, so they ride on the App Center's entry, then on
 * the app's tile, then on the page's notice. The world is the real sidebar column and rail with
 * the sidebar badges' module, the real App Center and Cost Center pages and the real badge stores,
 * over the one fake server.
 *
 * Given an Agent behind on a plugin, one unexpected error in the Cost Center's window, nothing
 * dismissed, and a folder holding the Plugins tile:
 * - the App Center's entry, in the column and on the rail, wears one dot whose hint names both
 *   trails; the Cost Center tile and the folder each carry their own trail's sentence and dot, the
 *   Plugins tile inside the folder its own, and the Models tile, with nothing waiting, neither;
 * - when the errors are marked read on the Cost Center, the entry names only the plugin's trail,
 *   and back in the App Center the Cost Center tile has no dot while the folder keeps its own.
 */
import { createElement as h, type ReactElement } from "react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { AppCenterLayout, UsageErrorItem } from "@prismshadow/penguin-server/api";
import type { ChatDrafts } from "../src/features/chat";
import { AppCenterPage } from "../src/features/app-center/app-center-page";
import { CompanyProvider } from "../src/features/company/company-state";
import { MainSidebarBadgesModule } from "../src/features/models/main-sidebar-badges.module";
import { UsagePage } from "../src/features/usage/usage-page";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ThemeProvider } from "../src/state/theme";
import { sidebarDeps, type SidebarDeps } from "../src/web-app/sidebar/deps";
import { badgesOf, composeNotes } from "../src/web-app/sidebar/modes";
import { CollapsedRail } from "../src/web-app/sidebar/rail";
import { Sidebar } from "../src/web-app/sidebar/sidebar";
import { agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import { button, click, hasButton, pressEscape, unmountAll, waitFor } from "./helpers/dom";
import { SYSTEM_APP_PAGES } from "./helpers/system-app-pages";

const ERROR: UsageErrorItem = {
  ts: "2026-11-19T01:00:00.000Z",
  firstTs: "2026-11-19T01:00:00.000Z",
  source: "session",
  kind: "unexpected",
  code: "run_failed",
  message: "The run failed",
  count: 1,
};

const PLUGINS = "system_agent/plugins";
const USAGE = "system_agent/usage";
const MODELS = "system_agent/models";
const LAYOUT: AppCenterLayout = {
  v: 1,
  items: [{ type: "folder", id: "tools", name: "Tools", apps: [PLUGINS] }],
};

const drafts: ChatDrafts = {
  newChatId: "new",
  useParked: () => [],
  removeParked: () => undefined,
  forgetSession: () => undefined,
  prepareNewChat: () => undefined,
  useNewChat: () => () => undefined,
};

/** The sidebar as the shell binds it: the badges' module's App Center anchor and its owner. */
const badgesModule = new MainSidebarBadgesModule();
const badges = badgesOf([
  {
    id: "main.apps-badge",
    from: "test",
    data: { anchor: "apps", order: 0 },
    code: badgesModule.apps,
  },
]);
const deps: SidebarDeps = {
  sections: [],
  modes: [],
  badges,
  useModes: () => [],
  useNotes: composeNotes(badges),
  drafts,
};
const Column = sidebarDeps.provide(deps, Sidebar);
const Rail = sidebarDeps.provide(deps, CollapsedRail);
const Owner = badgesModule.owner;

/** One page of the app with the column and the rail beside it, under the badges' one owner. */
function shell(page: ReactElement): ReactElement {
  return h(
    ThemeProvider,
    null,
    h(
      CompanyProvider,
      null,
      h(
        Owner,
        null,
        h("aside", { "aria-label": "Sidebar" }, h(Column)),
        h("aside", { "aria-label": "Rail" }, h(Rail)),
        h("main", null, page),
      ),
    ),
  );
}

const appCenterEntry = (where: "Sidebar" | "Rail") =>
  document.querySelector<HTMLAnchorElement>(`aside[aria-label="${where}"] a[href="/apps"]`)!;
const tile = (key: string) =>
  document.querySelector<HTMLButtonElement>(`li[data-app="${key}"] > button`)!;
const folder = () => document.querySelector<HTMLButtonElement>('li[data-folder="tools"] > button')!;
/** Whether a tile or an entry wears the update dot. */
const dotted = (el: Element) => el.querySelector(".bg-mark-new") !== null;

beforeAll(() => setActiveStrings(en));
afterAll(() => setActiveStrings(zh));
afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("carries the system apps' trails on the App Center's entry and their tiles, and the page clears both", async () => {
  agentServer(undefined, {
    role: "member",
    pluginUpdates: [{ name: "web-design", version: "2026.11.19.1" }],
    unexpectedErrors: [ERROR],
    prefs: {},
    appCenterLayout: LAYOUT,
  });
  const router = await mountAgentApp(shell(h(AppCenterPage)), {
    route: "/apps",
    at: "/apps",
    pages: SYSTEM_APP_PAGES,
    extra: [{ path: "/usage", element: shell(h(UsagePage)) }],
  });
  const plugin = en.todo.pluginUpdates(1);
  const error = en.todo.unexpectedErrors(1);
  const both = en.todo.joined([plugin, error]);
  await waitFor(() => appCenterEntry("Sidebar")?.dataset["tooltip"] === both, 60);

  // The entry, in the column and on the rail: one dot, both trails named.
  expect(appCenterEntry("Sidebar").getAttribute("aria-label")).toBe(
    `${en.appCenter.title} · ${both}`,
  );
  expect(dotted(appCenterEntry("Sidebar").parentElement!)).toBe(true);
  // The label is on screen, the sentence is not: the hint is marked to show over the label.
  expect(appCenterEntry("Sidebar").hasAttribute("data-tooltip-extra")).toBe(true);
  expect(appCenterEntry("Rail").getAttribute("aria-label")).toBe(`${en.appCenter.title} · ${both}`);

  // Each tile its own trail; the folder the trails of the apps inside it.
  await waitFor(() => tile(USAGE) !== null && folder() !== null, 40);
  const costCenter = en.appCenter.systemTileName("Cost Center");
  expect(tile(USAGE).dataset["tooltip"]).toBe(en.todo.joined([costCenter, error]));
  expect(tile(USAGE).getAttribute("aria-label")).toBe(en.todo.joined([costCenter, error]));
  expect(dotted(tile(USAGE))).toBe(true);
  expect(folder().dataset["tooltip"]).toBe(
    en.todo.joined([en.appCenter.folderTip("Tools", 1, 0), plugin]),
  );
  expect(dotted(folder())).toBe(true);
  expect(tile(MODELS).dataset["tooltip"]).toBe(en.appCenter.systemTileName("Models"));
  expect(dotted(tile(MODELS))).toBe(false);
  await click(folder());
  expect(tile(PLUGINS).dataset["tooltip"]).toBe(
    en.todo.joined([en.appCenter.systemTileName("Plugins"), plugin]),
  );
  expect(dotted(tile(PLUGINS))).toBe(true);
  await pressEscape();

  // The Cost Center's notice clears its trail: off the entry, and off its tile.
  await click(tile(USAGE));
  expect(whereIs(router)).toBe("/usage");
  await waitFor(() => hasButton(en.todo.markRead), 40);
  await click(button(en.todo.markRead));
  await waitFor(() => appCenterEntry("Sidebar").dataset["tooltip"] === plugin, 40);
  expect(appCenterEntry("Rail").getAttribute("aria-label")).toBe(
    `${en.appCenter.title} · ${plugin}`,
  );
  await click(appCenterEntry("Sidebar"));
  await waitFor(() => tile(USAGE) !== null, 40);
  expect(tile(USAGE).dataset["tooltip"]).toBe(costCenter);
  expect(dotted(tile(USAGE))).toBe(false);
  expect(dotted(folder())).toBe(true);
});
