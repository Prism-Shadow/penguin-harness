/**
 * The plugins page's header actions and a module row's verbs, rendered.
 *
 * - A member sees the search box, labelled, and no settings gear: filtering the list is not an
 *   admin's alone, the plugins' options are.
 * - An admin sees the search box and the settings gear, and the gear carries its words on the
 *   button, not only in its accessible name.
 * - An available module row offers Install, and an installed one Remove, each with its words
 *   beside the icon.
 *
 * Rendered to static markup inside the locale provider, as `owner-only-actions.test.ts` renders
 * its cards. How the header row wraps on a narrow screen is PageHeader's, not this page's.
 */
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { ModuleRow, PluginsHeaderActions } from "../src/features/plugins/plugins-page";
import { en } from "../src/lib/strings-en";
import { LocaleProvider } from "../src/state/locale";
import { stubLocalStorage } from "./helpers/storage";

beforeEach(() => {
  stubLocalStorage().setItem("penguin.lang", "en");
});

const inLocale = <P extends object>(child: FunctionComponent<P>, props: P) =>
  renderToStaticMarkup(createElement(LocaleProvider, null, createElement(child, props)));

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
  const row = (installed: boolean) =>
    inLocale(ModuleRow, {
      specifier: "@acme/plugin",
      entry: undefined,
      state: installed ? "active" : "none",
      shipped: false,
      busy: false,
      blocked: false,
      onInstall: installed ? null : () => undefined,
      onRemove: installed ? () => undefined : null,
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
});
