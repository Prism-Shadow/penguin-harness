/**
 * The registry (src/lib/shortcuts/registry.ts) holds the line on what a default may be: it
 * parses, it carries a modifier or is an F key, no two same-scope defaults collide on any
 * platform, no default sits on a browser-reserved chord, and no two commands share an id. An
 * unknown id is refused by name.
 */
import { describe, expect, it } from "vitest";
import { isBindableChord, parseChord } from "../src/lib/shortcuts/chord";
import { findConflicts } from "../src/lib/shortcuts/conflicts";
import { SHORTCUT_COMMANDS, commandById, defaultChord } from "../src/lib/shortcuts/registry";
import { browserReserved } from "../src/lib/shortcuts/reserved";
import type { Chord, CommandId, Platform } from "../src/lib/shortcuts/types";

const PLATFORMS: readonly Platform[] = ["mac", "windows", "linux"];

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

  it("every default is bindable: a real modifier or an F key, so nothing steals typing from an input", () => {
    for (const cmd of SHORTCUT_COMMANDS) {
      for (const platform of PLATFORMS) {
        const chord = defaultChord(cmd, platform);
        if (chord !== null)
          expect(isBindableChord(chord, platform), `${cmd.id} on ${platform}`).toBe(true);
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

  it("puts no default on a browser-reserved chord", () => {
    for (const platform of PLATFORMS) {
      const reserved = SHORTCUT_COMMANDS.filter((cmd) => {
        const chord = defaultChord(cmd, platform);
        return chord !== null && browserReserved(chord, platform);
      }).map((cmd) => cmd.id);
      expect(reserved, platform).toEqual([]);
    }
  });

  it("gives no two commands the same id", () => {
    const ids = SHORTCUT_COMMANDS.map((cmd) => cmd.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks commands up by id and refuses unknown ones", () => {
    expect(commandById("terminal.close").scope).toBe("terminal");
    expect(() => commandById("terminal.explode" as CommandId)).toThrow(/unknown shortcut command/);
  });
});
