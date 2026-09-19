/**
 * The Shortcuts settings page (src/features/settings/shortcuts-section.tsx) rendered to static
 * markup against an injected keymap: groups and rows in both dictionaries, the chord text per
 * platform, the reset affordance only on an overridden row, the browser-reserved note only in a
 * browser, and a conflict hint in the attention tone.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShortcutsSection } from "../src/features/settings/shortcuts-section";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { setHostForTests, setPlatformForTests } from "../src/lib/shortcuts/platform";
import { SHORTCUT_COMMANDS } from "../src/lib/shortcuts/registry";
import {
  KEYBINDINGS_KEY,
  configureKeybindingsStoreForTests,
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
      for (const group of ["general", "terminal", "editor"] as const) {
        expect(html).toContain(dict.shortcuts.groups[group]);
      }
      // No command sits in the panels group yet, so its heading is not drawn.
      expect(count(html, `>${dict.shortcuts.groups.panels}<`)).toBe(0);
    }
  });

  it("draws the chord the platform writes", () => {
    expect(render()).toContain("<kbd>Ctrl</kbd>");
    expect(render()).toContain("<kbd>W</kbd>");
    setPlatformForTests("mac");
    configureKeybindingsStoreForTests({});
    const mac = render();
    expect(mac).toContain("⌘W");
    expect(mac).toContain("⌃`");
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

  it("marks the terminal close as browser-reserved in a browser and not in the desktop app", () => {
    expect(count(render(), S.shortcuts.browserReserved)).toBe(1);
    setHostForTests("desktop");
    const desktop = render();
    expect(desktop).not.toContain(S.shortcuts.browserReserved);
    // On Linux the desktop shell's menu carries Ctrl+W (close): the same row now says so.
    expect(count(desktop, S.shortcuts.desktopMenuReserved)).toBe(1);
  });

  it("says which command shadows a global one, in the attention tone", () => {
    configureKeybindingsStoreForTests({
      storage: memStorage({ v: 1, linux: { "palette.toggle": "Mod+KeyW" } }),
    });
    const html = render();
    expect(html).toContain(
      S.shortcuts.conflictShadowed(
        S.shortcuts.commands["terminal.close"],
        S.shortcuts.scopes.terminal,
      ),
    );
    expect(html).toContain(toneInk.attention);
    // The winning row keeps its own note (reserved in a browser), not a conflict.
    expect(count(html, S.shortcuts.browserReserved)).toBe(1);
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
