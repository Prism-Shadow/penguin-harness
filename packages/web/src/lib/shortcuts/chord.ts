/**
 * Chords as strings and as events. The string grammar is
 * `(Mod\+|Ctrl\+|Alt\+|Shift\+)*<code>`, modifier tokens in that fixed order and at most one of
 * each, `<code>` a `KeyboardEvent.code` value: "Mod+KeyW", "Ctrl+Backquote", "F5". It is what the
 * registry authors, what the store persists and what the server validates, so `parseChord` and
 * `serializeChord` round-trip exactly and anything malformed parses to null rather than to a
 * guess.
 */
import type { Chord, KeyLike, Platform } from "./types";

const CHORD_RE = /^(Mod\+)?(Ctrl\+)?(Alt\+)?(Shift\+)?([A-Za-z][A-Za-z0-9]*)$/;

/** Parses the persisted form; null for anything outside the grammar (including an empty code). */
export function parseChord(text: string): Chord | null {
  const m = CHORD_RE.exec(text);
  if (m === null) return null;
  return {
    code: m[5]!,
    mod: m[1] !== undefined,
    ctrl: m[2] !== undefined,
    alt: m[3] !== undefined,
    shift: m[4] !== undefined,
  };
}

export function serializeChord(chord: Chord): string {
  return `${chord.mod ? "Mod+" : ""}${chord.ctrl ? "Ctrl+" : ""}${chord.alt ? "Alt+" : ""}${
    chord.shift ? "Shift+" : ""
  }${chord.code}`;
}

/**
 * Folds the platform into a chord: on Windows and Linux Control IS Mod, so a `Ctrl+` token there
 * means the same key as `Mod+` and is recorded as Mod. On macOS the two stay distinct (⌃ vs ⌘).
 */
export function normalizeChord(chord: Chord, platform: Platform): Chord {
  if (platform === "mac" || !chord.ctrl) return chord;
  return { ...chord, mod: true, ctrl: false };
}

export function chordEquals(a: Chord | null, b: Chord | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.code === b.code &&
    a.mod === b.mod &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift
  );
}

/** `KeyboardEvent.code` values of the modifier keys themselves; a press of one is never a chord. */
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "CapsLock",
  "Fn",
  "FnLock",
]);

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

/**
 * A `code` for events that carry none (some virtual keyboards and synthetic events): a letter
 * maps to its US position, a digit to `DigitN`, the punctuation the registry uses to its code,
 * and a named key (Escape, F5, ArrowUp) passes through. Anything else stays empty.
 */
export function codeFromKey(key: string): string {
  if (key.length === 1) {
    if (/[a-z]/i.test(key)) return `Key${key.toUpperCase()}`;
    if (/[0-9]/.test(key)) return `Digit${key}`;
    const punct: Record<string, string> = {
      "`": "Backquote",
      "-": "Minus",
      "=": "Equal",
      "[": "BracketLeft",
      "]": "BracketRight",
      "\\": "Backslash",
      ";": "Semicolon",
      "'": "Quote",
      ",": "Comma",
      ".": "Period",
      "/": "Slash",
      " ": "Space",
    };
    return punct[key] ?? "";
  }
  // "Unidentified", "Dead" and "Process" are the browser saying it does not know the key.
  if (key === "Unidentified" || key === "Dead" || key === "Process") return "";
  return /^[A-Z][A-Za-z0-9]*$/.test(key) ? key : "";
}

/**
 * The chord an event IS, or null when it is not one: a modifier-only press, a key inside an IME
 * composition (the IME owns it), a Meta chord on Windows/Linux (the Super key belongs to the
 * OS), or an event with no usable code. An auto-repeat IS the chord: the caller still has to
 * prevent the browser's own action for it (a held ⌘S would otherwise open Save Page from the
 * first repeat on), and decides for itself not to run the command again.
 */
export function chordOf(e: KeyLike, platform: Platform): Chord | null {
  if (e.isComposing === true) return null;
  const code = e.code !== "" ? e.code : codeFromKey(e.key);
  if (code === "" || isModifierCode(code)) return null;
  if (platform === "mac") {
    return { code, mod: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
  }
  if (e.metaKey) return null;
  return { code, mod: e.ctrlKey, ctrl: false, alt: e.altKey, shift: e.shiftKey };
}

/**
 * True when the chord can be a binding without stealing typing from an input: it holds Mod or
 * literal Control, or Alt off a Mac (⌥+letter types characters on macOS — ⌥E is the accent key,
 * `@` is ⌥L on a German Mac), or its key is a function key. Shift on its own does not qualify —
 * Shift+B is a capital B, Shift+Enter a newline in the composer — and only counts alongside one
 * of the others.
 */
export function isBindableChord(chord: Chord, platform: Platform): boolean {
  return (
    chord.mod ||
    chord.ctrl ||
    (chord.alt && platform !== "mac") ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(chord.code)
  );
}
