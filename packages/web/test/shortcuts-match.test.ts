/**
 * The matcher (src/lib/shortcuts/match.ts) against the registry's defaults: which platform
 * chord runs which command, how a focus scope beats global, and how defaults relocate on a
 * non-US layout while user chords stay physical.
 */
import { describe, expect, it } from "vitest";
import { parseChord } from "../src/lib/shortcuts/chord";
import { isShortcut, matchShortcut, relocateChord } from "../src/lib/shortcuts/match";
import { SHORTCUT_COMMANDS, defaultChord } from "../src/lib/shortcuts/registry";
import type { Chord, CommandId, KeyLike, Keymap, Platform } from "../src/lib/shortcuts/types";

function defaults(platform: Platform): Map<CommandId, Chord | null> {
  return new Map(SHORTCUT_COMMANDS.map((cmd) => [cmd.id, defaultChord(cmd, platform)]));
}

function key(overrides: Partial<KeyLike> & { code: string }): KeyLike {
  return { key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides };
}

const ALL = ["global", "terminal", "editor"] as const;

describe("the default table per platform", () => {
  it("closes the terminal on ⌘W on a Mac and Ctrl+W elsewhere", () => {
    expect(matchShortcut(key({ code: "KeyW", metaKey: true }), defaults("mac"), ALL, "mac")).toBe(
      "terminal.close",
    );
    expect(
      matchShortcut(key({ code: "KeyW", ctrlKey: true }), defaults("mac"), ALL, "mac"),
    ).toBeNull();
    expect(
      matchShortcut(key({ code: "KeyW", ctrlKey: true }), defaults("windows"), ALL, "windows"),
    ).toBe("terminal.close");
    expect(
      matchShortcut(key({ code: "KeyW", ctrlKey: true }), defaults("linux"), ALL, "linux"),
    ).toBe("terminal.close");
  });

  it("toggles the terminal on Ctrl+` on every platform, and not on ⌘`", () => {
    for (const platform of ["mac", "windows", "linux"] as const) {
      expect(
        matchShortcut(key({ code: "Backquote", ctrlKey: true }), defaults(platform), ALL, platform),
      ).toBe("terminal.toggle");
    }
    expect(
      matchShortcut(key({ code: "Backquote", metaKey: true }), defaults("mac"), ALL, "mac"),
    ).toBeNull();
  });

  it("saves on ⌘S / Ctrl+S and opens the palette on ⌘P / Ctrl+P", () => {
    expect(matchShortcut(key({ code: "KeyS", metaKey: true }), defaults("mac"), ALL, "mac")).toBe(
      "editor.save",
    );
    expect(
      matchShortcut(key({ code: "KeyS", ctrlKey: true }), defaults("linux"), ALL, "linux"),
    ).toBe("editor.save");
    expect(matchShortcut(key({ code: "KeyP", metaKey: true }), defaults("mac"), ALL, "mac")).toBe(
      "palette.toggle",
    );
    expect(
      matchShortcut(key({ code: "KeyP", ctrlKey: true }), defaults("windows"), ALL, "windows"),
    ).toBe("palette.toggle");
  });

  it("matches only the scopes that hold focus", () => {
    const e = key({ code: "KeyS", ctrlKey: true });
    expect(matchShortcut(e, defaults("linux"), ["global"], "linux")).toBeNull();
    expect(matchShortcut(e, defaults("linux"), ["terminal", "global"], "linux")).toBeNull();
    expect(matchShortcut(e, defaults("linux"), ["editor"], "linux")).toBe("editor.save");
  });
});

describe("resolution", () => {
  it("lets the focus scope beat global on the same chord, and registry order break a tie", () => {
    const chord = parseChord("Mod+KeyW")!;
    const keymap: Keymap = new Map<CommandId, Chord | null>([
      ["palette.toggle", chord], // global, first in registry order
      ["terminal.toggle", chord], // global
      ["terminal.close", chord], // terminal scope
      ["editor.save", null],
    ]);
    const e = key({ code: "KeyW", ctrlKey: true });
    expect(matchShortcut(e, keymap, ["terminal", "global"], "linux")).toBe("terminal.close");
    expect(matchShortcut(e, keymap, ["global"], "linux")).toBe("palette.toggle");
  });

  it("never matches an unbound command", () => {
    const keymap: Keymap = new Map<CommandId, Chord | null>([["terminal.close", null]]);
    expect(matchShortcut(key({ code: "KeyW", ctrlKey: true }), keymap, ALL, "linux")).toBeNull();
    expect(
      isShortcut(key({ code: "KeyW", ctrlKey: true }), keymap, "terminal.close", "linux"),
    ).toBe(false);
  });

  it("isShortcut is one command's own test", () => {
    expect(
      isShortcut(key({ code: "KeyS", metaKey: true }), defaults("mac"), "editor.save", "mac"),
    ).toBe(true);
    expect(
      isShortcut(key({ code: "KeyS", ctrlKey: true }), defaults("mac"), "editor.save", "mac"),
    ).toBe(false);
    expect(
      isShortcut(
        key({ code: "KeyS", metaKey: true, shiftKey: true }),
        defaults("mac"),
        "editor.save",
        "mac",
      ),
    ).toBe(false);
  });
});

describe("layout relocation", () => {
  // The AZERTY keys that differ from US: the physical W position types Z and vice versa.
  const azerty = new Map<string, string>([
    ["KeyW", "z"],
    ["KeyZ", "w"],
    ["KeyA", "q"],
    ["KeyQ", "a"],
    ["KeyS", "s"],
  ]);

  it("moves a default letter to the key that types it, and leaves the rest alone", () => {
    expect(relocateChord(parseChord("Mod+KeyW")!, azerty).code).toBe("KeyZ");
    expect(relocateChord(parseChord("Mod+KeyS")!, azerty).code).toBe("KeyS");
    expect(relocateChord(parseChord("Ctrl+Backquote")!, azerty).code).toBe("Backquote");
    // A letter the map does not know keeps its US position (Firefox and Safari expose no map at all).
    expect(relocateChord(parseChord("Mod+KeyP")!, new Map()).code).toBe("KeyP");
  });

  it("looks past the letter keys: US-Dvorak types s on Semicolon and w on Comma", () => {
    const dvorak = new Map<string, string>([
      ["KeyS", "o"],
      ["Semicolon", "s"],
      ["KeyW", ","],
      ["Comma", "w"],
      ["KeyP", "r"],
      ["KeyR", "p"],
      ["KeyB", "x"],
      ["KeyN", "b"],
      ["Backquote", "`"],
    ]);
    expect(relocateChord(parseChord("Mod+KeyS")!, dvorak).code).toBe("Semicolon");
    expect(relocateChord(parseChord("Mod+KeyW")!, dvorak).code).toBe("Comma");
    expect(relocateChord(parseChord("Mod+KeyP")!, dvorak).code).toBe("KeyR");
    expect(relocateChord(parseChord("Mod+KeyB")!, dvorak).code).toBe("KeyN");
    expect(relocateChord(parseChord("Ctrl+Backquote")!, dvorak).code).toBe("Backquote");
    // A key that types no character (an F key) has nothing to relocate by.
    expect(relocateChord(parseChord("F5")!, dvorak).code).toBe("F5");
  });
});
