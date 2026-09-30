/**
 * The Plugins page's install gate: only a module plugin the running build ships gets an Install
 * button. The server refuses any other (400 plugin_not_shipped), so a registry row the build does
 * not ship is dimmed, says it is not in this build, and gives the reason on hover, instead of
 * offering a button that can only fail.
 *
 * vitest runs node-only here, so the row is rendered to static markup inside the router its link
 * needs and the locale provider it reads, with the stored language pinned to English.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { InstalledPluginsResponse, PluginIndexEntry } from "@prismshadow/penguin-server/api";
import { availablePluginRows, ModuleRow } from "../src/features/plugins/plugins-page";
import { en } from "../src/lib/strings-en";
import { LocaleProvider } from "../src/state/locale";

const SHIPPED = "@prismshadow/penguin-plugin-sandbox-wsl";
const ELSEWHERE = "@acme/penguin-plugin-sandbox-other";

const entry = (name: string): PluginIndexEntry => ({
  name,
  version: "0.2.2",
  description: "A sandbox backend.",
  authors: ["Prism Shadow"],
  license: "Apache-2.0",
});

const deployment: InstalledPluginsResponse = {
  plugins: [],
  shipped: [SHIPPED],
  file: ".project_config.toml",
  machineId: "Self000000000000",
  restartPending: false,
};

type Row = ReturnType<typeof availablePluginRows>[number];

/** The row's own class list — the outermost element's — rather than a button's inside it. */
const rowClass = (html: string) => (/^<div class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ");

/** As an admin sees it: the Install verb is wired, so a row without the button means the gate. */
const render = (row: Row) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        LocaleProvider,
        null,
        createElement(ModuleRow, {
          specifier: row.specifier,
          entry: row.entry,
          state: row.state,
          shipped: row.shipped,
          busy: false,
          blocked: false,
          onInstall: () => {},
          onRemove: null,
        }),
      ),
    ),
  );

beforeAll(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => "en",
    setItem: () => {},
    removeItem: () => {},
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("the Plugins page's install gate", () => {
  const rows = availablePluginRows(deployment, [entry(SHIPPED), entry(ELSEWHERE)]);
  const row = (name: string) => rows.find((r) => r.specifier === name)!;

  it("marks each available row by whether this build ships it", () => {
    expect(rows.map((r) => [r.specifier, r.shipped])).toEqual([
      [SHIPPED, true],
      [ELSEWHERE, false],
    ]);
  });

  it("offers Install for a plugin the build ships", () => {
    const html = render(row(SHIPPED));
    expect(html).toContain(`aria-label="${en.plugins.install} ${SHIPPED}"`);
    expect(html).toContain(en.plugins.notInstalled);
    expect(html).not.toContain(en.plugins.notShippedHint);
    expect(rowClass(html)).not.toContain("opacity-60");
  });

  it("offers nothing for a plugin the build does not ship, dims it, and says why", () => {
    const html = render(row(ELSEWHERE));
    expect(html).not.toContain(`aria-label="${en.plugins.install} `);
    expect(html).toContain(en.plugins.notShipped);
    expect(html).toContain(`title="${en.plugins.notShippedHint}"`);
    expect(rowClass(html)).toContain("opacity-60");
  });

  it("offers nothing at all when the build ships no plugin", () => {
    const none = availablePluginRows({ ...deployment, shipped: [] }, [entry(SHIPPED)]);
    expect(none.map((r) => r.shipped)).toEqual([false]);
    expect(render(none[0]!)).not.toContain(`aria-label="${en.plugins.install} `);
  });
});
