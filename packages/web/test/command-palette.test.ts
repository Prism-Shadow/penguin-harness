import { describe, expect, it } from "vitest";
import { isCommandPaletteShortcut } from "../src/lib/command-palette";

const key = (
  k: string,
  mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {},
) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("command palette shortcut", () => {
  it("is Ctrl+P off macOS and Cmd+P on it, and nothing else", () => {
    expect(isCommandPaletteShortcut(key("p", { ctrlKey: true }), false)).toBe(true);
    expect(isCommandPaletteShortcut(key("P", { ctrlKey: true }), false)).toBe(true);
    expect(isCommandPaletteShortcut(key("p", { metaKey: true }), false)).toBe(false);
    expect(isCommandPaletteShortcut(key("p", { metaKey: true }), true)).toBe(true);
    expect(isCommandPaletteShortcut(key("p", { ctrlKey: true }), true)).toBe(false);
    // Ctrl+Shift+P too: a page filling the app may own Ctrl+P, and the palette is its way out.
    expect(isCommandPaletteShortcut(key("P", { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(isCommandPaletteShortcut(key("P", { metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(isCommandPaletteShortcut(key("p", { ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isCommandPaletteShortcut(key("o", { ctrlKey: true }), false)).toBe(false);
  });
});
