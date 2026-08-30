import { describe, expect, it } from "vitest";
import { filterPaletteActions, isCommandPaletteShortcut } from "../src/lib/command-palette";

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
    // The browser's own chords stay the browser's.
    expect(isCommandPaletteShortcut(key("P", { ctrlKey: true, shiftKey: true }), false)).toBe(
      false,
    );
    expect(isCommandPaletteShortcut(key("p", { ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isCommandPaletteShortcut(key("o", { ctrlKey: true }), false)).toBe(false);
  });
});

describe("command palette filter", () => {
  const actions = [
    { id: "history", label: "Harness history", keywords: ["version", "hmr"] },
    { id: "reload", label: "Reload page" },
  ];
  it("lists everything for an empty query, in registration order", () => {
    expect(filterPaletteActions(actions, "  ").map((a) => a.id)).toEqual(["history", "reload"]);
  });
  it("matches every token, case-insensitively, against the label and the keywords", () => {
    expect(filterPaletteActions(actions, "HIST").map((a) => a.id)).toEqual(["history"]);
    expect(filterPaletteActions(actions, "harness hist").map((a) => a.id)).toEqual(["history"]);
    expect(filterPaletteActions(actions, "hmr").map((a) => a.id)).toEqual(["history"]);
    expect(filterPaletteActions(actions, "page harness")).toEqual([]);
  });
});
