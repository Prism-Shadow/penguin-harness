/**
 * Chords as the platform writes them: Apple's glyph run on macOS (`⌘W`, `⌃⇧\``, `⌥⌘I` — the
 * order Apple's menus use, no separators), `Ctrl+Alt+Shift+W` elsewhere. Pure; the layout map,
 * when the browser exposes one, turns a physical letter code into the character the key types.
 */
import type { Chord, CommandId, Keymap, Platform } from "./types";

const MAC_KEY_GLYPHS: Record<string, string> = {
  Escape: "⎋",
  Enter: "↩",
  NumpadEnter: "↩",
  Tab: "⇥",
  Backspace: "⌫",
  Delete: "⌦",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowRight: "→",
  ArrowDown: "↓",
  Space: "Space",
  Home: "↖",
  End: "↘",
  PageUp: "⇞",
  PageDown: "⇟",
};

const OTHER_KEY_NAMES: Record<string, string> = {
  Escape: "Esc",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowRight: "→",
  ArrowDown: "↓",
  Space: "Space",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

const PUNCTUATION: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  IntlBackslash: "\\",
};

/**
 * The character a code types on the US layout, lower-case, or null for a key that types none
 * (Escape, F5, the arrows). What layout relocation looks for on another layout.
 */
export function usCharacter(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter !== undefined) return letter.toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit !== undefined) return digit;
  return PUNCTUATION[code] ?? null;
}

/**
 * The text for the non-modifier key: what the key types on the current layout when the browser
 * exposes one (a relocated `Semicolon` on Dvorak reads "S"), else its US character or name; the
 * code itself when nothing better is known.
 */
export function keyLabel(
  code: string,
  platform: Platform,
  layout?: ReadonlyMap<string, string>,
): string {
  const typed = layout?.get(code);
  if (typed !== undefined && typed.length === 1 && typed.trim() !== "") return typed.toUpperCase();
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter !== undefined) return letter;
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit !== undefined) return digit;
  const numpad = /^Numpad([0-9])$/.exec(code)?.[1];
  if (numpad !== undefined) return `Num ${numpad}`;
  const punct = PUNCTUATION[code];
  if (punct !== undefined) return punct;
  const named = platform === "mac" ? MAC_KEY_GLYPHS[code] : OTHER_KEY_NAMES[code];
  return named ?? code;
}

export function formatChord(
  chord: Chord,
  platform: Platform,
  layout?: ReadonlyMap<string, string>,
): string {
  const key = keyLabel(chord.code, platform, layout);
  if (platform === "mac") {
    return `${chord.ctrl ? "⌃" : ""}${chord.alt ? "⌥" : ""}${chord.shift ? "⇧" : ""}${
      chord.mod ? "⌘" : ""
    }${key}`;
  }
  const parts: string[] = [];
  if (chord.mod || chord.ctrl) parts.push("Ctrl");
  if (chord.alt) parts.push("Alt");
  if (chord.shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** The command's current chord as text, or null when it is unbound. */
export function formatBinding(
  id: CommandId,
  keymap: Keymap,
  platform: Platform,
  layout?: ReadonlyMap<string, string>,
): string | null {
  const chord = keymap.get(id) ?? null;
  return chord === null ? null : formatChord(chord, platform, layout);
}
