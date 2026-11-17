// @vitest-environment jsdom
/**
 * The plugin market's tabs and the detail's address (features/plugins/plugins-page.tsx), on the
 * real page over the fake server. The market is grouped by contents here, so its tabs are All,
 * Skills and Hooks.
 *
 * - Given the market, its groups are tabs: All lists every plugin's card, and choosing Hooks
 *   lists only the hook plugin's and names the tab in the address.
 * - Given an address naming a tab and a plugin that tab hides, the plugin's detail is open over
 *   the market all the same.
 * - Given a card opened from the grid, the address names its plugin; Back closes the detail and
 *   leaves the market where it was.
 * - Given a search that matches nothing in the tab on show but matches elsewhere, the empty line
 *   says how many match across every plugin, and "Show all results" lists them on All.
 * - Given the market sends popularity figures, the ranking beside the grid lists the plugins
 *   most installed first, a row opens that plugin's detail, and "Popular" is a sort; given none,
 *   neither the ranking nor that sort is there.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { PluginsPage } from "../src/features/plugins/plugins-page";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import { button, click, dialogs, field, run, type, unmountAll, waitFor } from "./helpers/dom";

const CHARTS = {
  name: "charts",
  description: "Draw charts",
  version: "1.0.0",
  package: "@penguinharness/charts",
  source: "builtin",
  title: "Charts",
  skills: [{ name: "chart", description: "Draw a chart", version: "2026.10.01.1" }],
  hooks: [],
  mcpServers: [],
} as unknown as PluginItem;

const TIDY = {
  name: "tidy",
  description: "Tidy the workspace when a run stops",
  version: "1.0.0",
  package: "@penguinharness/tidy",
  source: "builtin",
  title: "Tidy Up",
  skills: [],
  hooks: ["stop"],
  hookVersion: "2026.10.01.1",
  mcpServers: [],
} as unknown as PluginItem;

beforeEach(() => {
  localStorage.setItem("penguin.lang", "en");
  localStorage.setItem("penguin.pluginsGroupBy", "kind");
  setActiveStrings(en);
});

/** The fake server, with the market's curation when one is given. */
const serve = (market?: unknown) =>
  agentServer(undefined, { library: [CHARTS, TIDY], ...(market !== undefined ? { market } : {}) });

afterEach(async () => {
  await unmountAll();
  localStorage.clear();
});

const open = (at: string, market?: unknown) => {
  serve(market);
  return mountAgentApp(h(PluginsPage), { route: "/plugins", at });
};
/** The plugins whose cards the grid shows, in order. */
const cards = () =>
  [...document.querySelectorAll("[data-plugin]")]
    .filter((el) => el.tagName === "ARTICLE")
    .map((el) => el.getAttribute("data-plugin"));
const tab = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (el) => el.textContent === label,
  )!;
/** The open detail layers, by the plugin each is named for. */
const details = () => dialogs().map((d) => d.getAttribute("aria-label"));

/** The titles the ranking lists, in rank order. */
const ranked = () =>
  [...document.querySelectorAll(".showcase-ranking-open")].map((el) => el.textContent);
const sortOptions = async () => {
  await click(button(en.plugins.sortLabel));
  const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  await click(button(en.plugins.sortLabel));
  return options;
};

describe("the market's ranking", () => {
  it("lists the most installed first, opens a plugin from its row, and offers the popular sort", async () => {
    const market = {
      hero: [],
      selected: [],
      art: {},
      source: "embedded",
      popularity: {
        source: "placeholder",
        generatedAt: "2026-11-17",
        items: {
          "@penguinharness/charts": { installs: 120, weekly: 3 },
          "@penguinharness/tidy": { installs: 450, weekly: 9 },
        },
      },
    };
    const router = await open("/plugins", market);
    await waitFor(() => ranked().length === 2, 40);
    expect(ranked()).toEqual(["Tidy Up", "Charts"]);
    expect(await sortOptions()).toContain(en.plugins.sort.popular);

    await click(document.querySelectorAll<HTMLElement>(".showcase-ranking-open")[1]!);
    expect(details()).toEqual(["Charts"]);
    expect(whereIs(router)).toBe("/plugins?plugin=charts");
  });

  it("is not there, nor is the popular sort, without popularity figures", async () => {
    await open("/plugins");
    await waitFor(() => cards().length === 2, 40);
    expect(document.querySelector(".showcase-ranking")).toBeNull();
    expect(await sortOptions()).not.toContain(en.plugins.sort.popular);
  });
});

describe("the market's tabs", () => {
  it("list every card on All, and only the tab's on another, which the address names", async () => {
    const router = await open("/plugins");
    await waitFor(() => cards().length === 2, 40);
    expect(cards()).toEqual(["charts", "tidy"]);
    expect(tab(en.plugins.tabAll).getAttribute("aria-selected")).toBe("true");

    await click(tab(en.plugins.kindLabel.hooks));
    expect(cards()).toEqual(["tidy"]);
    expect(whereIs(router)).toBe("/plugins?tab=hooks");
  });

  it("open the detail an address names even when its tab hides the card", async () => {
    await open("/plugins?tab=hooks&plugin=charts");
    await waitFor(() => details().length === 1, 40);
    expect(cards()).toEqual(["tidy"]);
    expect(details()).toEqual(["Charts"]);
  });

  it("put a card's detail in the address, and Back closes it", async () => {
    const router = await open("/plugins?tab=skills");
    await waitFor(() => cards().length === 1, 40);
    await click(document.querySelector('[data-plugin="charts"] button')!);
    expect(details()).toEqual(["Charts"]);
    expect(whereIs(router)).toBe("/plugins?tab=skills&plugin=charts");

    await run(() => router.navigate(-1));
    await waitFor(() => details().length === 0, 20);
    expect(whereIs(router)).toBe("/plugins?tab=skills");
    expect(cards()).toEqual(["charts"]);
  });

  it("say a search's matches in other tabs, and show them all on request", async () => {
    const router = await open("/plugins?tab=hooks");
    await waitFor(() => cards().length === 1, 40);
    await type(field(en.plugins.searchPlaceholder), "draw");
    expect(cards()).toEqual([]);
    expect(document.body.textContent).toContain(en.plugins.noMatchHere(1));

    await click(button(en.plugins.showAllResults));
    expect(cards()).toEqual(["charts"]);
    expect(whereIs(router)).toBe("/plugins");
  });
});
