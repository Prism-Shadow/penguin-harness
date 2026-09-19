/**
 * Chords as strings and as events (src/lib/shortcuts/chord.ts): the persisted grammar
 * round-trips, and an event becomes a chord by physical key with the platform's modifier
 * mapping — or does not become one at all.
 */
import { describe, expect, it } from "vitest";
import {
  chordOf,
  codeFromKey,
  isBindableChord,
  normalizeChord,
  parseChord,
  serializeChord,
} from "../src/lib/shortcuts/chord";
import type { KeyLike } from "../src/lib/shortcuts/types";

function key(overrides: Partial<KeyLike> & { code: string }): KeyLike {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("chord grammar", () => {
  it("round-trips every modifier in the fixed order", () => {
    for (const text of [
      "Mod+KeyW",
      "Ctrl+Backquote",
      "Mod+Shift+KeyO",
      "Mod+Alt+KeyB",
      "F5",
      "Mod+Ctrl+Alt+Shift+Digit1",
    ]) {
      const chord = parseChord(text);
      expect(chord, text).not.toBeNull();
      expect(serializeChord(chord!)).toBe(text);
    }
  });

  it("rejects modifiers out of order, repeated, lower-cased, or with no key", () => {
    for (const text of [
      "Shift+Mod+KeyW",
      "Mod+Mod+KeyW",
      "mod+KeyW",
      "Mod+",
      "",
      "Mod+Key W",
      "Meta+KeyW",
      "Ctrl+Mod+KeyW",
    ]) {
      expect(parseChord(text), text).toBeNull();
    }
  });

  it("folds literal Ctrl into Mod on Windows and Linux only", () => {
    const chord = parseChord("Ctrl+Backquote")!;
    expect(normalizeChord(chord, "mac")).toEqual(chord);
    expect(normalizeChord(chord, "windows")).toEqual({ ...chord, mod: true, ctrl: false });
    expect(normalizeChord(chord, "linux")).toEqual({ ...chord, mod: true, ctrl: false });
  });
});

describe("chordOf", () => {
  it("maps Mod to the Command key on a Mac and keeps Control literal there", () => {
    expect(chordOf(key({ code: "KeyW", key: "w", metaKey: true }), "mac")).toEqual({
      code: "KeyW",
      mod: true,
      ctrl: false,
      alt: false,
      shift: false,
    });
    expect(chordOf(key({ code: "Backquote", key: "`", ctrlKey: true }), "mac")).toMatchObject({
      mod: false,
      ctrl: true,
    });
  });

  it("maps Mod to Control elsewhere and never reports a literal ctrl", () => {
    for (const platform of ["windows", "linux"] as const) {
      expect(chordOf(key({ code: "KeyW", key: "w", ctrlKey: true }), platform)).toEqual({
        code: "KeyW",
        mod: true,
        ctrl: false,
        alt: false,
        shift: false,
      });
    }
  });

  it("leaves the Windows / Super key to the OS", () => {
    expect(chordOf(key({ code: "KeyW", key: "w", metaKey: true }), "windows")).toBeNull();
    expect(chordOf(key({ code: "KeyW", key: "w", metaKey: true }), "linux")).toBeNull();
  });

  it("is null for a modifier-only press and an IME composition", () => {
    expect(
      chordOf(key({ code: "ControlLeft", key: "Control", ctrlKey: true }), "linux"),
    ).toBeNull();
    expect(chordOf(key({ code: "MetaLeft", key: "Meta", metaKey: true }), "mac")).toBeNull();
    expect(
      chordOf(key({ code: "KeyW", key: "w", ctrlKey: true, isComposing: true }), "linux"),
    ).toBeNull();
  });

  it("still reads an auto-repeat as the chord, so the caller can prevent the browser's action for it", () => {
    expect(chordOf(key({ code: "KeyW", key: "w", metaKey: true, repeat: true }), "mac")).toEqual({
      code: "KeyW",
      mod: true,
      ctrl: false,
      alt: false,
      shift: false,
    });
  });

  it("reads the physical key, so an IME, Option and Shift do not change the chord", () => {
    // A CJK IME reports key "Process" while active; macOS Option reports the composed glyph; Shift upper-cases.
    expect(chordOf(key({ code: "KeyW", key: "Process", ctrlKey: true }), "linux")?.code).toBe(
      "KeyW",
    );
    expect(chordOf(key({ code: "KeyW", key: "∑", altKey: true, metaKey: true }), "mac")?.code).toBe(
      "KeyW",
    );
    expect(
      chordOf(key({ code: "KeyW", key: "W", shiftKey: true, ctrlKey: true }), "linux"),
    ).toMatchObject({
      code: "KeyW",
      shift: true,
    });
  });

  it("falls back to the key when the event carries no code", () => {
    expect(chordOf(key({ code: "", key: "w", ctrlKey: true }), "linux")?.code).toBe("KeyW");
    expect(chordOf(key({ code: "", key: "1", ctrlKey: true }), "linux")?.code).toBe("Digit1");
    expect(chordOf(key({ code: "", key: "`", ctrlKey: true }), "linux")?.code).toBe("Backquote");
    expect(chordOf(key({ code: "", key: "F5" }), "linux")?.code).toBe("F5");
    expect(chordOf(key({ code: "", key: "Unidentified", ctrlKey: true }), "linux")).toBeNull();
  });
});

describe("codeFromKey", () => {
  it("names the US position of a character and passes named keys through", () => {
    expect(codeFromKey("a")).toBe("KeyA");
    expect(codeFromKey("Z")).toBe("KeyZ");
    expect(codeFromKey("7")).toBe("Digit7");
    expect(codeFromKey("Escape")).toBe("Escape");
    expect(codeFromKey("ArrowUp")).toBe("ArrowUp");
    expect(codeFromKey("Unidentified")).toBe("");
    expect(codeFromKey("Dead")).toBe("");
    expect(codeFromKey("Process")).toBe("");
    expect(codeFromKey("é")).toBe("");
  });
});

describe("isBindableChord", () => {
  it("accepts Mod, literal Ctrl, Alt off a Mac, and a bare function key", () => {
    expect(isBindableChord(parseChord("Mod+KeyW")!, "mac")).toBe(true);
    expect(isBindableChord(parseChord("Ctrl+Backquote")!, "mac")).toBe(true);
    expect(isBindableChord(parseChord("Alt+KeyW")!, "linux")).toBe(true);
    expect(isBindableChord(parseChord("Alt+KeyW")!, "windows")).toBe(true);
    expect(isBindableChord(parseChord("F5")!, "linux")).toBe(true);
    expect(isBindableChord(parseChord("F24")!, "mac")).toBe(true);
    expect(isBindableChord(parseChord("Mod+Shift+KeyO")!, "linux")).toBe(true);
  });

  it("refuses typing: a bare key, Shift alone, and Option alone on a Mac", () => {
    expect(isBindableChord(parseChord("KeyW")!, "linux")).toBe(false);
    expect(isBindableChord(parseChord("F25")!, "linux")).toBe(false);
    expect(isBindableChord(parseChord("Shift+KeyB")!, "linux")).toBe(false);
    expect(isBindableChord(parseChord("Shift+Enter")!, "mac")).toBe(false);
    expect(isBindableChord(parseChord("Alt+KeyE")!, "mac")).toBe(false);
    expect(isBindableChord(parseChord("Alt+Shift+KeyE")!, "mac")).toBe(false);
  });
});
