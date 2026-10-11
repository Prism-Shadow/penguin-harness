/**
 * The keys the shell takes before the page sees them.
 */
import { describe, expect, it } from "vitest";
import { isDevToolsKey, isMenuBarKey, type KeyChord } from "../src/shortcuts.js";

const chord = (over: Partial<KeyChord>): KeyChord => ({
  type: "keyDown",
  key: "",
  alt: false,
  control: false,
  meta: false,
  shift: false,
  ...over,
});

describe("isMenuBarKey", () => {
  it("is F10 alone", () => {
    expect(isMenuBarKey(chord({ key: "F10" }))).toBe(true);
    expect(isMenuBarKey(chord({ key: "F10", alt: true }))).toBe(false);
    // Alt+F10 and friends belong to the page (the terminal wants every Alt combination).
    expect(isMenuBarKey(chord({ key: "F10", type: "keyUp" }))).toBe(false);
    expect(isMenuBarKey(chord({ key: "F12" }))).toBe(false);
  });
});

describe("isDevToolsKey", () => {
  it("is F12, or Ctrl+Shift+I in either case", () => {
    expect(isDevToolsKey(chord({ key: "F12" }))).toBe(true);
    expect(isDevToolsKey(chord({ key: "I", control: true, shift: true }))).toBe(true);
    expect(isDevToolsKey(chord({ key: "i", control: true, shift: true }))).toBe(true);
  });

  it("leaves the neighbouring combinations to the page", () => {
    // The terminal's copy and paste live one letter away, and Ctrl+I is a Tab in a shell.
    expect(isDevToolsKey(chord({ key: "C", control: true, shift: true }))).toBe(false);
    expect(isDevToolsKey(chord({ key: "i", control: true }))).toBe(false);
    expect(isDevToolsKey(chord({ key: "i", control: true, shift: true, alt: true }))).toBe(false);
    expect(isDevToolsKey(chord({ key: "F12", control: true }))).toBe(false);
    expect(isDevToolsKey(chord({ key: "F12", type: "keyUp" }))).toBe(false);
  });
});
