/**
 * The plugins page's header actions and a module row's verbs, rendered.
 *
 * - A member sees the search box, labelled, and no settings gear: filtering the list is not an
 *   admin's alone, the plugins' options are.
 * - An admin sees the search box and the settings gear, and the gear carries its words on the
 *   button, not only in its accessible name.
 * - An available module row offers Install, and an installed one Remove, each with its words
 *   beside the icon. A shared row's Remove is disabled and described by the row's "shared" tag
 *   and its hint, so a screen reader says why.
 * - An installed row shows the version on disk, not the registry's; a row the registry has not
 *   answered for yet claims no "no entry" (a failed request says why instead); one for another
 *   platform says so and its Install is disabled.
 *
 * Rendered to static markup inside the locale provider, as `owner-only-actions.test.ts` renders
 * its cards. How the header row wraps on a narrow screen is PageHeader's, not this page's.
 */
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { ModuleRow, PluginsHeaderActions } from "../src/features/plugins/plugins-page";
import { en } from "../src/lib/strings-en";
import { LocaleProvider } from "../src/state/locale";
import { stubLocalStorage } from "./helpers/storage";

beforeEach(() => {
  stubLocalStorage().setItem("penguin.lang", "en");
});

// In a router: a row the registry knows is a link to its registry page.
const inLocale = <P extends object>(child: FunctionComponent<P>, props: P) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(LocaleProvider, null, createElement(child, props)),
    ),
  );

/** The text a reader sees inside the button with this accessible name; undefined when absent. */
function buttonText(html: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<button[^>]*aria-label="${escaped}"[^>]*>(.*?)</button>`, "s").exec(
    html,
  );
  return match?.[1]?.replace(/<[^>]+>/g, "").trim();
}

const header = (isAdmin: boolean) =>
  inLocale(PluginsHeaderActions, {
    query: "",
    onQuery: () => undefined,
    isAdmin,
    machinePicker: null,
    onOpenSettings: () => undefined,
  });

describe("the plugins page header", () => {
  it("offers a member the search box and no settings gear", () => {
    const html = header(false);
    expect(html).toContain(`aria-label="${en.plugins.searchPlaceholder}"`);
    expect(buttonText(html, en.plugins.openSettings)).toBeUndefined();
  });

  it("offers an admin the search box and a settings gear that says what it is", () => {
    const html = header(true);
    expect(html).toContain(`aria-label="${en.plugins.searchPlaceholder}"`);
    expect(buttonText(html, en.plugins.openSettings)).toBe(en.plugins.openSettings);
  });
});

describe("a module plugin's row", () => {
  const row = (installed: boolean, shared?: boolean) =>
    inLocale(ModuleRow, {
      specifier: "@acme/plugin",
      entry: undefined,
      state: installed ? "active" : "none",
      shipped: false,
      shared,
      busy: false,
      blocked: false,
      onInstall: installed ? null : () => undefined,
      onRemove: installed ? () => undefined : null,
      quickStart: { reason: "not on this server" },
    });

  it("offers Install on an available row, its words beside the icon", () => {
    const html = row(false);
    expect(buttonText(html, `${en.plugins.install} @acme/plugin`)).toBe(en.plugins.install);
    expect(buttonText(html, `${en.plugins.uninstall} @acme/plugin`)).toBeUndefined();
  });

  it("offers Remove on an installed row, its words beside the icon", () => {
    const html = row(true);
    expect(buttonText(html, `${en.plugins.uninstall} @acme/plugin`)).toBe(en.plugins.uninstall);
    expect(buttonText(html, `${en.plugins.install} @acme/plugin`)).toBeUndefined();
  });

  /** The opening tag of the row's Remove button. */
  const removeButton = (html: string) =>
    new RegExp(`<button[^>]*aria-label="${en.plugins.uninstall} @acme/plugin"[^>]*>`).exec(
      html,
    )?.[0] ?? "";

  it("describes a shared row's disabled Remove by its tag and hint", () => {
    const html = row(true, true);
    const button = removeButton(html);
    expect(button).toContain('disabled=""');
    const ids = /aria-describedby="([^"]+)"/.exec(button)?.[1]?.split(" ") ?? [];
    const textOf = (id: string) =>
      new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]*)<`).exec(html)?.[1];
    expect(ids.map(textOf)).toEqual([en.plugins.sharedTag, en.plugins.sharedHint]);
  });

  it("leaves an own row's Remove enabled and undescribed", () => {
    const button = removeButton(row(true));
    expect(button).not.toBe("");
    expect(button).not.toContain('disabled=""');
    expect(button).not.toContain("aria-describedby");
  });
});

describe("what a module plugin's row says", () => {
  const ENTRY = {
    name: "@acme/plugin",
    version: "0.2.3",
    description: "What the registry says.",
    authors: [],
    license: "MIT",
  };
  const base = {
    specifier: "@acme/plugin",
    shipped: false,
    busy: false,
    blocked: false,
    onRemove: null,
    quickStart: { reason: "not on this server" },
  };

  it("an installed row shows the version on disk, not the registry's", () => {
    const html = inLocale(ModuleRow, {
      ...base,
      entry: ENTRY,
      state: "active",
      version: "0.2.2",
      onInstall: null,
    });
    expect(html).toContain("v0.2.2");
    expect(html).not.toContain("v0.2.3");
  });

  it("claims no missing entry before the registry answers, and names the right one after", () => {
    const row = (registry: "loading" | "failed" | "answered", shipped: boolean) =>
      inLocale(ModuleRow, {
        ...base,
        shipped,
        entry: undefined,
        state: "active",
        registry,
        onInstall: null,
      });
    expect(row("loading", false)).not.toContain(en.plugins.noEntry);
    expect(row("loading", true)).not.toContain(en.plugins.shippedNoEntry);
    expect(row("answered", false)).toContain(en.plugins.noEntry);
    expect(row("answered", true)).toContain(en.plugins.shippedNoEntry);
    // A failed request says why, rather than reading as "the registry has none".
    expect(row("failed", false)).toContain(en.plugins.registryUnavailable);
    expect(row("failed", false)).not.toContain(en.plugins.noEntry);
  });

  it("a row for another platform says so, and its Install is disabled", () => {
    const html = inLocale(ModuleRow, {
      ...base,
      entry: ENTRY,
      state: "none",
      otherPlatform: ["darwin"],
      onInstall: () => undefined,
    });
    expect(html).toContain(en.plugins.otherPlatform("macOS"));
    expect(html).not.toContain(en.plugins.notInstalled);
    expect(html).toMatch(
      /<button(?=[^>]*aria-label="Install @acme\/plugin")(?=[^>]*disabled="")[^>]*>/,
    );
  });
});
