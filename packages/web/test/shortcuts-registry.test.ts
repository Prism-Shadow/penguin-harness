/**
 * The registry (src/lib/shortcuts/registry.ts) holds the line on what a default may be: it
 * parses, it carries a modifier or is an F key, no two same-scope defaults collide on any
 * platform, a literal Ctrl token is used only where macOS must not follow ⌘, only the
 * terminal close sits on a browser-reserved chord, and every id passes the server's grammar.
 */
import { describe, expect, it } from "vitest";
import { hasModifierOrFKey, parseChord } from "../src/lib/shortcuts/chord";
import { findConflicts } from "../src/lib/shortcuts/conflicts";
import {
  SHORTCUT_COMMANDS,
  SHORTCUT_GROUPS,
  commandById,
  defaultChord,
} from "../src/lib/shortcuts/registry";
import { browserReserved } from "../src/lib/shortcuts/reserved";
import { S } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import type { Chord, CommandId, Platform } from "../src/lib/shortcuts/types";

const PLATFORMS: readonly Platform[] = ["mac", "windows", "linux"];
/** The id grammar the server enforces on `ui_prefs.keybindings`. */
const ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

function defaultsFor(platform: Platform): Map<CommandId, Chord | null> {
  return new Map(SHORTCUT_COMMANDS.map((cmd) => [cmd.id, defaultChord(cmd, platform)]));
}

describe("registry defaults", () => {
  it("every default string parses", () => {
    for (const cmd of SHORTCUT_COMMANDS) {
      for (const text of Object.values(cmd.defaults)) {
        if (text === null || text === undefined) continue;
        expect(parseChord(text), `${cmd.id}: ${text}`).not.toBeNull();
      }
    }
  });

  it("no default is a bare key: a modifier or an F key, so nothing steals typing from an input", () => {
    for (const cmd of SHORTCUT_COMMANDS) {
      for (const platform of PLATFORMS) {
        const chord = defaultChord(cmd, platform);
        if (chord !== null) expect(hasModifierOrFKey(chord), `${cmd.id} on ${platform}`).toBe(true);
      }
    }
  });

  it("no two defaults collide in the same scope on any platform", () => {
    for (const platform of PLATFORMS) {
      const conflicts = findConflicts(defaultsFor(platform), SHORTCUT_COMMANDS).filter(
        (c) => c.kind === "same-scope",
      );
      expect(conflicts, platform).toEqual([]);
    }
  });

  it("uses a literal Ctrl token only where the macOS default must not follow ⌘", () => {
    const literalCtrl = SHORTCUT_COMMANDS.filter((cmd) =>
      Object.values(cmd.defaults).some(
        (text) => typeof text === "string" && text.includes("Ctrl+"),
      ),
    ).map((cmd) => cmd.id);
    expect(literalCtrl).toEqual(["terminal.toggle"]);
  });

  it("puts only the terminal close on a browser-reserved chord", () => {
    for (const platform of PLATFORMS) {
      const reserved = SHORTCUT_COMMANDS.filter((cmd) => {
        const chord = defaultChord(cmd, platform);
        return chord !== null && browserReserved(chord, platform);
      }).map((cmd) => cmd.id);
      expect(reserved, platform).toEqual(["terminal.close"]);
    }
  });

  it("ids match the server grammar and are unique", () => {
    const ids = SHORTCUT_COMMANDS.map((cmd) => cmd.id);
    for (const id of ids) expect(id).toMatch(ID_RE);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("groups every command under a drawn group", () => {
    for (const cmd of SHORTCUT_COMMANDS) expect(SHORTCUT_GROUPS).toContain(cmd.group);
  });

  it("looks commands up by id and refuses unknown ones", () => {
    expect(commandById("terminal.close").scope).toBe("terminal");
    expect(() => commandById("terminal.explode" as CommandId)).toThrow(/unknown shortcut command/);
  });
});

describe("registry labels", () => {
  it("has a label for every command and group in both dictionaries", () => {
    for (const cmd of SHORTCUT_COMMANDS) {
      expect(S.shortcuts.commands[cmd.id], `zh ${cmd.id}`).toBeTruthy();
      expect(en.shortcuts.commands[cmd.id], `en ${cmd.id}`).toBeTruthy();
    }
    for (const group of SHORTCUT_GROUPS) {
      expect(S.shortcuts.groups[group], `zh ${group}`).toBeTruthy();
      expect(en.shortcuts.groups[group], `en ${group}`).toBeTruthy();
    }
  });
});
