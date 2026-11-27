/** @vitest-environment jsdom */
/**
 * The three-item nav (PRFC-0033): the real sidebar column and rail over the one fake server, with
 * the page table the features contribute (test/helpers/system-app-pages.ts).
 *
 * - Given development mode, an administrator's column holds New chat, Agents and the App Center
 *   in its fixed block, and nothing to star, drag or fold; the scroll area holds no nav rows. The
 *   rail holds the last conversation, New chat, Agents and the App Center. The system apps are
 *   not among them, though an administrator may open every one.
 * - Given company mode, the organization's rows are plain links at the top of the scroll area,
 *   above the mode's channel list, with nothing to star or fold; there is no fixed block.
 * - Given the favourites and fold choices an earlier build stored in this browser, the nav is the
 *   same three rows, and the stored choices are left where they are, unread.
 */
import { createElement as h, type ComponentType } from "react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { ChatDrafts } from "../src/features/chat";
import { CompanyProvider } from "@prismshadow/penguin-library-organization/web/company/company-state";
import type { SidebarMode } from "../src/lib/sidebar-contributions";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ThemeProvider } from "../src/state/theme";
import { sidebarDeps, type SidebarDeps } from "../src/web-app/sidebar/deps";
import type { ModeEntry, SectionEntry } from "../src/web-app/sidebar/modes";
import { CollapsedRail } from "../src/web-app/sidebar/rail";
import { Sidebar } from "../src/web-app/sidebar/sidebar";
import { agentServer, mountAgentApp } from "./helpers/agent-app";
import { unmountAll } from "./helpers/dom";
import { SYSTEM_APP_PAGES } from "./helpers/system-app-pages";

const drafts: ChatDrafts = {
  newChatId: "new",
  useParked: () => [],
  removeParked: () => undefined,
  forgetSession: () => undefined,
  prepareNewChat: () => undefined,
  useNewChat: () => () => undefined,
};

/** A company mode contributed to the sidebar, current, with two organization pages. */
const companyMode: SidebarMode = {
  listName: () => "Channels",
  useMode: () => ({
    available: true,
    current: true,
    select: () => null,
    navItems: [
      { key: "overview", to: "/org/proj/acme/overview", label: "Overview", icon: "tiles" },
      { key: "chart", to: "/org/proj/acme/chart", label: "Org Chart", icon: "robot" },
    ],
  }),
};
const COMPANY: ModeEntry[] = [
  {
    id: "company.mode",
    key: "company",
    title: "Company",
    titleZh: "公司",
    icon: "building",
    order: 10,
    mode: companyMode,
  },
];
const ChannelList: ComponentType = () => h("p", null, "Channel list");
const CHANNELS: SectionEntry[] = [
  { id: "channels", mode: "company", place: "body", order: 10, section: { Full: ChannelList } },
];

async function open(modes: readonly ModeEntry[] = [], sections: readonly SectionEntry[] = []) {
  agentServer();
  const deps: SidebarDeps = {
    sections,
    modes,
    badges: [],
    useModes: () => modes.map((m) => m.mode.useMode()),
    useNotes: () => new Map(),
    drafts,
  };
  const Column = sidebarDeps.provide(deps, Sidebar);
  const Rail = sidebarDeps.provide(deps, CollapsedRail);
  await mountAgentApp(
    h(
      ThemeProvider,
      null,
      h(
        CompanyProvider,
        null,
        h("aside", { "aria-label": "Sidebar" }, h(Column)),
        h("aside", { "aria-label": "Rail" }, h(Rail)),
      ),
    ),
    { route: "/home", at: "/home", pages: SYSTEM_APP_PAGES },
  );
}

const column = () => document.querySelector<HTMLElement>('aside[aria-label="Sidebar"]')!;
/** The column's scroll area: everything under the fixed block. */
const scrollArea = () => column().querySelector<HTMLElement>("[data-find-region]")!;
/** The rows of the column's fixed block (the nav above the scroll area), by their visible names. */
const fixedRows = () =>
  [...column().querySelectorAll("nav")]
    .filter((nav) => !scrollArea().contains(nav))
    .flatMap((nav) => [...nav.querySelectorAll("a, button")])
    .map((el) => el.textContent?.trim());
/** The rail's entries, by their names. */
const railEntries = () =>
  [...document.querySelectorAll('aside[aria-label="Rail"] nav [aria-label]')].map((el) =>
    el.getAttribute("aria-label"),
  );
/** Whether the column offers anything that stars or drags a nav row, or folds the nav away. */
const pinOrFold = () =>
  [...column().querySelectorAll("nav")].some(
    (nav) => nav.querySelector('[aria-pressed], [draggable="true"]') !== null,
  ) ||
  column().querySelector(
    `button[aria-label="${en.nav.expandGroup}"], button[aria-label="${en.nav.collapseGroup}"]`,
  ) !== null;

beforeAll(() => setActiveStrings(en));
afterAll(() => setActiveStrings(zh));
afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("shows New chat, Agents and the App Center, and on the rail the same after the last conversation", async () => {
  await open();
  expect(fixedRows()).toEqual([en.chat.newSessionMenu, en.nav.agents, en.appCenter.title]);
  expect(scrollArea().children).toHaveLength(0);
  expect(pinOrFold()).toBe(false);
  expect(railEntries()).toEqual([
    en.nav.lastConversation,
    en.chat.newSessionMenu,
    en.nav.agents,
    en.appCenter.title,
  ]);
});

it("draws company mode's rows as plain links at the top of the scroll area, above its channels", async () => {
  await open(COMPANY, CHANNELS);
  // No fixed block: every nav of the column scrolls with the lists.
  expect([...column().querySelectorAll("nav")].every((nav) => scrollArea().contains(nav))).toBe(
    true,
  );
  const rows = [...scrollArea().querySelectorAll("nav a")];
  expect(rows.map((a) => [a.textContent?.trim(), a.getAttribute("href")])).toEqual([
    ["Overview", "/org/proj/acme/overview"],
    ["Org Chart", "/org/proj/acme/chart"],
  ]);
  const text = scrollArea().textContent ?? "";
  expect(text.indexOf("Org Chart")).toBeLessThan(text.indexOf("Channel list"));
  expect(pinOrFold()).toBe(false);
});

it("keeps the three rows whatever favourites and fold an earlier build stored, and leaves them stored", async () => {
  const stored = {
    "penguin.sidebarNavPinned": '{"agents":false,"apps":false}',
    "penguin.sidebarNavGroupCollapsed": "collapsed",
    "penguin.sidebarModeNavPinned.company": '{"overview":true}',
  };
  for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
  await open();
  expect(fixedRows()).toEqual([en.chat.newSessionMenu, en.nav.agents, en.appCenter.title]);
  expect(scrollArea().children).toHaveLength(0);
  for (const [key, value] of Object.entries(stored)) expect(localStorage.getItem(key)).toBe(value);
});
