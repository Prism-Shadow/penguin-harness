/**
 * Chord labels (src/lib/shortcuts/format.ts): Apple's glyph run on a Mac, `Ctrl+…` names
 * elsewhere, the layout map's letters, and the code itself for anything unknown.
 */
import { describe, expect, it } from "vitest";
import { parseChord } from "../src/lib/shortcuts/chord";
import { formatBinding, formatChord, keyLabel } from "../src/lib/shortcuts/format";
import type { Chord, CommandId } from "../src/lib/shortcuts/types";

const chord = (text: string): Chord => parseChord(text)!;

describe("macOS", () => {
  it("writes the glyphs in Apple's order with no separators", () => {
    expect(formatChord(chord("Mod+KeyW"), "mac")).toBe("⌘W");
    expect(formatChord(chord("Ctrl+Backquote"), "mac")).toBe("⌃`");
    expect(formatChord(chord("Ctrl+Shift+Backquote"), "mac")).toBe("⌃⇧`");
    expect(formatChord(chord("Mod+Alt+KeyI"), "mac")).toBe("⌥⌘I");
    expect(formatChord(chord("Mod+Ctrl+Alt+Shift+KeyA"), "mac")).toBe("⌃⌥⇧⌘A");
  });

  it("uses the Apple key glyphs", () => {
    expect(formatChord(chord("Mod+Escape"), "mac")).toBe("⌘⎋");
    expect(formatChord(chord("Mod+Enter"), "mac")).toBe("⌘↩");
    expect(formatChord(chord("Mod+Tab"), "mac")).toBe("⌘⇥");
    expect(formatChord(chord("Mod+Backspace"), "mac")).toBe("⌘⌫");
    expect(formatChord(chord("Mod+Delete"), "mac")).toBe("⌘⌦");
    expect(formatChord(chord("Mod+ArrowLeft"), "mac")).toBe("⌘←");
    expect(formatChord(chord("Mod+Home"), "mac")).toBe("⌘↖");
    expect(formatChord(chord("Mod+PageDown"), "mac")).toBe("⌘⇟");
    expect(formatChord(chord("Mod+Space"), "mac")).toBe("⌘Space");
    expect(formatChord(chord("F12"), "mac")).toBe("F12");
  });
});

describe("Windows and Linux", () => {
  it("writes Ctrl, Alt, Shift and the key joined by +", () => {
    expect(formatChord(chord("Mod+KeyW"), "windows")).toBe("Ctrl+W");
    expect(formatChord(chord("Mod+Alt+Shift+KeyW"), "linux")).toBe("Ctrl+Alt+Shift+W");
    // A literal Ctrl token reads as Ctrl there too (it IS Mod on these platforms).
    expect(formatChord(chord("Ctrl+Backquote"), "linux")).toBe("Ctrl+`");
  });

  it("uses the conventional key names", () => {
    expect(formatChord(chord("Mod+Escape"), "windows")).toBe("Ctrl+Esc");
    expect(formatChord(chord("Mod+Enter"), "windows")).toBe("Ctrl+Enter");
    expect(formatChord(chord("Shift+Insert"), "windows")).toBe("Shift+Insert");
    expect(formatChord(chord("Mod+PageUp"), "linux")).toBe("Ctrl+PgUp");
    expect(formatChord(chord("Mod+ArrowUp"), "linux")).toBe("Ctrl+↑");
    expect(formatChord(chord("Alt+F4"), "windows")).toBe("Alt+F4");
  });
});

describe("key text", () => {
  it("names digits, punctuation and the numpad, and falls back to the code", () => {
    expect(keyLabel("Digit3", "linux")).toBe("3");
    expect(keyLabel("Minus", "linux")).toBe("-");
    expect(keyLabel("Equal", "linux")).toBe("=");
    expect(keyLabel("BracketLeft", "linux")).toBe("[");
    expect(keyLabel("Backslash", "linux")).toBe("\\");
    expect(keyLabel("Semicolon", "linux")).toBe(";");
    expect(keyLabel("Quote", "linux")).toBe("'");
    expect(keyLabel("Comma", "linux")).toBe(",");
    expect(keyLabel("Period", "linux")).toBe(".");
    expect(keyLabel("Slash", "linux")).toBe("/");
    expect(keyLabel("Numpad7", "linux")).toBe("Num 7");
    expect(keyLabel("MediaPlayPause", "linux")).toBe("MediaPlayPause");
  });

  it("shows the character the key types when a layout map is given", () => {
    const azerty = new Map([["KeyZ", "w"]]);
    expect(keyLabel("KeyZ", "linux", azerty)).toBe("W");
    expect(keyLabel("KeyZ", "linux")).toBe("Z");
    expect(formatChord(chord("Mod+KeyZ"), "mac", azerty)).toBe("⌘W");
    // Dvorak relocates the save chord onto the semicolon position, which then reads S.
    expect(keyLabel("Semicolon", "linux", new Map([["Semicolon", "s"]]))).toBe("S");
    expect(formatChord(chord("Mod+Semicolon"), "windows", new Map([["Semicolon", "s"]]))).toBe(
      "Ctrl+S",
    );
    // A dead key or a multi-character entry is not a label; the US letter stands.
    expect(keyLabel("KeyZ", "linux", new Map([["KeyZ", ""]]))).toBe("Z");
  });
});

describe("formatBinding", () => {
  it("formats the bound chord and is null when unbound", () => {
    const keymap = new Map<CommandId, Chord | null>([
      ["terminal.close", chord("Mod+KeyW")],
      ["editor.save", null],
    ]);
    expect(formatBinding("terminal.close", keymap, "mac")).toBe("⌘W");
    expect(formatBinding("editor.save", keymap, "mac")).toBeNull();
    expect(formatBinding("palette.toggle", keymap, "mac")).toBeNull();
  });
});
