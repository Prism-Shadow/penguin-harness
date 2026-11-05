/**
 * The Shortcuts settings page (features/settings/shortcuts-section.tsx), rendered to static
 * markup against an injected keymap.
 *
 * - Every command is listed under its group, in either language.
 * - A chord is drawn the way the platform writes it.
 * - A row can be reset only when overridden, and "Reset all" is enabled only when something is.
 * - No default sits on a chord the browser keeps; a binding on one is marked in the attention
 *   tone on either host. A chord the browser also uses gets a muted note, and in the desktop
 *   app the desktop menu's claim is named first. A note follows a new binding at once.
 * - A command shadowing a global one is named in the attention tone, and a same-scope clash
 *   is reported on both rows.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShortcutsSection } from "../src/features/settings/shortcuts-section";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { parseChord } from "../src/lib/shortcuts/chord";
import { setHostForTests, setPlatformForTests } from "../src/lib/shortcuts/platform";
import { SHORTCUT_COMMANDS } from "../src/lib/shortcuts/registry";
import {
  KEYBINDINGS_KEY,
  configureKeybindingsStoreForTests,
  setBinding,
} from "../src/lib/shortcuts/store";
import { memoryStorage } from "./helpers/storage";

/** The attention tone's ink, as the package's token class spells it. */
const ATTENTION = "text-tone-attention-fg";

/** A keybindings mirror holding `doc`, or nothing. */
const keybindings = (doc?: object) =>
  memoryStorage(doc === undefined ? {} : { [KEYBINDINGS_KEY]: JSON.stringify(doc) });

const render = (): string => renderToStaticMarkup(createElement(ShortcutsSection));
const count = (html: string, needle: string): number => html.split(needle).length - 1;

beforeEach(() => {
  setPlatformForTests("linux");
  setHostForTests("browser");
  configureKeybindingsStoreForTests({ storage: keybindings(), layout: null });
});

afterEach(() => {
  setActiveStrings(zh);
  setPlatformForTests(null);
  setHostForTests(null);
  configureKeybindingsStoreForTests({ storage: null, layout: null });
});

describe("ShortcutsSection", () => {
  it("lists every command under its group, in both dictionaries", () => {
    for (const dict of [zh, en]) {
      setActiveStrings(dict);
      const html = render();
      for (const cmd of SHORTCUT_COMMANDS) expect(html).toContain(dict.shortcuts.commands[cmd.id]);
      for (const group of ["general", "panels", "terminal", "editor"] as const) {
        expect(count(html, `>${dict.shortcuts.groups[group]}<`)).toBe(1);
      }
    }
  });

  it("draws the chord the platform writes", () => {
    const linux = render();
    expect(linux).toContain("<kbd>Ctrl</kbd>");
    expect(linux).toContain("<kbd>Alt</kbd>");
    expect(linux).toContain("<kbd>P</kbd>");
    setPlatformForTests("mac");
    configureKeybindingsStoreForTests({});
    const mac = render();
    expect(mac).toContain("⌥⌘P");
    expect(mac).toContain("⌃⌥`");
    expect(mac).toContain("⌘S");
    expect(mac).not.toContain("Ctrl");
  });

  it("offers the per-row reset only on an overridden row, and Reset all only when something is", () => {
    const clean = render();
    expect(count(clean, `data-tooltip="${S.shortcuts.resetRow}"`)).toBe(0);
    const resetAll = new RegExp(`<button[^>]* disabled=""[^>]*>[^<]*${S.shortcuts.resetAll}`);
    expect(clean).toMatch(resetAll);

    configureKeybindingsStoreForTests({
      storage: keybindings({ v: 1, linux: { "editor.save": null } }),
    });
    const one = render();
    expect(count(one, `data-tooltip="${S.shortcuts.resetRow}"`)).toBe(1);
    expect(one).toContain(S.shortcuts.unbound);
    expect(one).not.toMatch(resetAll);
  });

  it("puts no default on a chord the browser keeps, and marks a binding on one in the attention tone on either host", () => {
    expect(render()).not.toContain(S.shortcuts.browserReserved);
    configureKeybindingsStoreForTests({
      storage: keybindings({ v: 1, linux: { "terminal.close": "Mod+KeyW" } }),
    });
    for (const host of ["browser", "desktop"] as const) {
      setHostForTests(host);
      const html = render();
      expect(count(html, S.shortcuts.browserReserved), host).toBe(1);
      expect(html, host).toContain(ATTENTION);
    }
  });

  it("notes a chord the browser also uses, muted, and names the desktop menu's claim first in the desktop app", () => {
    // Save's and find's defaults take over the browser's Save Page and find; no other default
    // touches the browser.
    expect(count(render(), S.shortcuts.browserCommon)).toBe(2);
    configureKeybindingsStoreForTests({
      storage: keybindings({ v: 1, linux: { "palette.toggle": "Mod+KeyR" } }),
    });
    const browser = render();
    expect(count(browser, S.shortcuts.browserCommon)).toBe(3);
    expect(browser).not.toContain(ATTENTION);
    setHostForTests("desktop");
    const desktop = render();
    // Reload is the desktop menu's too, so that row names the menu; Save and find keep the
    // browser's note.
    expect(count(desktop, S.shortcuts.desktopMenuReserved)).toBe(1);
    expect(count(desktop, S.shortcuts.browserCommon)).toBe(2);
  });

  it("shows a binding's note as soon as the binding lands", () => {
    expect(count(render(), S.shortcuts.browserReserved)).toBe(0);
    setBinding("palette.toggle", parseChord("Mod+KeyT"));
    expect(count(render(), S.shortcuts.browserReserved)).toBe(1);
  });

  it("says which command shadows a global one, in the attention tone", () => {
    configureKeybindingsStoreForTests({
      storage: keybindings({ v: 1, linux: { "palette.toggle": "Ctrl+Alt+Backquote" } }),
    });
    const html = render();
    expect(
      count(
        html,
        S.shortcuts.conflictShadowed(
          S.shortcuts.commands["terminal.close"],
          S.shortcuts.scopes.terminal,
        ),
      ),
    ).toBe(1);
    expect(html).toContain(ATTENTION);
  });

  it("reports a same-scope clash on both rows", () => {
    configureKeybindingsStoreForTests({
      storage: keybindings({ v: 1, linux: { "palette.toggle": "Ctrl+Backquote" } }),
    });
    const html = render();
    expect(html).toContain(S.shortcuts.conflictSame(S.shortcuts.commands["terminal.toggle"]));
    expect(html).toContain(S.shortcuts.conflictSame(S.shortcuts.commands["palette.toggle"]));
  });
});
