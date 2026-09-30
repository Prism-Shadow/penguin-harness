/**
 * The Shortcuts settings page (src/features/settings/shortcuts-section.tsx) rendered to static
 * markup against an injected keymap: groups and rows in both dictionaries with no rule between
 * rows, the chord text per platform, the reset affordance only on an overridden row, the
 * browser's notes on either host (a reserved chord in the attention tone, a shared one muted),
 * the desktop menu's note in the desktop app, a note that follows a new binding at once, and a
 * conflict hint in the attention tone.
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
  type KeybindingsStorage,
} from "../src/lib/shortcuts/store";
import { toneInk } from "../src/lib/tone";

function memStorage(doc?: object): KeybindingsStorage {
  const map = new Map<string, string>();
  if (doc !== undefined) map.set(KEYBINDINGS_KEY, JSON.stringify(doc));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const render = (): string => renderToStaticMarkup(createElement(ShortcutsSection));
const count = (html: string, needle: string): number => html.split(needle).length - 1;

beforeEach(() => {
  setPlatformForTests("linux");
  setHostForTests("browser");
  configureKeybindingsStoreForTests({ storage: memStorage(), layout: null });
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

  it("lists the rows without a rule between them", () => {
    expect(render()).not.toContain("divide-y");
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
    expect(count(clean, `title="${S.shortcuts.resetRow}"`)).toBe(0);
    expect(clean).toMatch(/<button[^>]* disabled=""[^>]*>[^<]*全部恢复默认/);

    configureKeybindingsStoreForTests({
      storage: memStorage({ v: 1, linux: { "editor.save": null } }),
    });
    const one = render();
    expect(count(one, `title="${S.shortcuts.resetRow}"`)).toBe(1);
    expect(one).toContain(S.shortcuts.unbound);
    expect(one).not.toMatch(/<button[^>]* disabled=""[^>]*>[^<]*全部恢复默认/);
  });

  it("puts no default on a chord the browser keeps, and marks a binding on one in the attention tone on either host", () => {
    expect(render()).not.toContain(S.shortcuts.browserReserved);
    configureKeybindingsStoreForTests({
      storage: memStorage({ v: 1, linux: { "terminal.close": "Mod+KeyW" } }),
    });
    for (const host of ["browser", "desktop"] as const) {
      setHostForTests(host);
      const html = render();
      expect(count(html, S.shortcuts.browserReserved), host).toBe(1);
      expect(html, host).toContain(toneInk.attention);
    }
  });

  it("notes a chord the browser also uses, muted, and names the desktop menu's claim first in the desktop app", () => {
    // Save's default takes over the browser's Save Page; no other default touches the browser.
    expect(count(render(), S.shortcuts.browserCommon)).toBe(1);
    configureKeybindingsStoreForTests({
      storage: memStorage({ v: 1, linux: { "palette.toggle": "Mod+KeyR" } }),
    });
    const browser = render();
    expect(count(browser, S.shortcuts.browserCommon)).toBe(2);
    expect(browser).not.toContain(toneInk.attention);
    setHostForTests("desktop");
    const desktop = render();
    // Reload is the desktop menu's too, so that row names the menu; Save keeps the browser's note.
    expect(count(desktop, S.shortcuts.desktopMenuReserved)).toBe(1);
    expect(count(desktop, S.shortcuts.browserCommon)).toBe(1);
  });

  it("shows a binding's note as soon as the binding lands", () => {
    expect(count(render(), S.shortcuts.browserReserved)).toBe(0);
    setBinding("palette.toggle", parseChord("Mod+KeyT"));
    expect(count(render(), S.shortcuts.browserReserved)).toBe(1);
  });

  it("says which command shadows a global one, in the attention tone", () => {
    configureKeybindingsStoreForTests({
      storage: memStorage({ v: 1, linux: { "palette.toggle": "Ctrl+Alt+Backquote" } }),
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
    expect(html).toContain(toneInk.attention);
  });

  it("reports a same-scope clash on both rows", () => {
    configureKeybindingsStoreForTests({
      storage: memStorage({ v: 1, linux: { "palette.toggle": "Ctrl+Backquote" } }),
    });
    const html = render();
    expect(html).toContain(S.shortcuts.conflictSame(S.shortcuts.commands["terminal.toggle"]));
    expect(html).toContain(S.shortcuts.conflictSame(S.shortcuts.commands["palette.toggle"]));
  });
});
