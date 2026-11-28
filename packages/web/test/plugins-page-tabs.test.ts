// @vitest-environment jsdom
/**
 * The plugin market's tabs and the detail's address (library/plugin/src/web/plugins-page.tsx), on the
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
 * - Given a selected plugin with install figures, opening the catalogue still goes straight to
 *   the results. Switching to rows keeps the current tab and details, and a revisit uses rows.
 * - Given live install figures, Popular is available as a sort. Sample figures are excluded.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { PluginsPage } from "@prismshadow/penguin-library-plugin/web/plugins-page";
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

const sortOptions = async () => {
  await click(button(en.plugins.sortLabel));
  const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  await click(button(en.plugins.sortLabel));
  return options;
};

describe("the catalogue layout", () => {
  const curated = (source: "live" | "placeholder") => ({
    hero: [CHARTS.package],
    selected: [CHARTS.package],
    art: {},
    source: "embedded",
    popularity: {
      source,
      generatedAt: "2026-11-17",
      items: { [CHARTS.package!]: { installs: 120, weekly: 3 } },
    },
  });
  it("keeps the current category and detail when rows are chosen, and remembers the layout", async () => {
    const router = await open("/plugins?tab=skills", curated("placeholder"));
    await waitFor(() => cards().length === 1, 40);
    expect(document.querySelector(".showcase-carousel, .showcase-ranking")).toBeNull();
    await click(button(en.plugins.listLayout));
    expect(button(en.plugins.listLayout).getAttribute("aria-pressed")).toBe("true");
    expect(cards()).toEqual(["charts"]);
    await click(document.querySelector('[data-plugin="charts"] button')!);
    expect(details()).toEqual(["Charts"]);
    expect(whereIs(router)).toBe("/plugins?tab=skills&plugin=charts");
    await unmountAll();
    await open("/plugins", curated("placeholder"));
    await waitFor(() => cards().length === 2, 40);
    expect(document.querySelector(".showcase-carousel, .showcase-ranking")).toBeNull();
    expect(button(en.plugins.listLayout).getAttribute("aria-pressed")).toBe("true");
    expect(await sortOptions()).not.toContain(en.plugins.sort.popular);
  });

  it("offers sorting by live install figures", async () => {
    await open("/plugins", curated("live"));
    await waitFor(() => cards().length === 2, 40);
    expect(await sortOptions()).toContain(en.plugins.sort.popular);
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
