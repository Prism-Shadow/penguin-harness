/**
 * The byte sequences the touch key bar puts on the wire.
 *
 * Kept apart from the component because the bar bypasses xterm's key handling entirely: it
 * writes into the shell's input stream directly, so everything a real keypress would have
 * consulted on the way through — the terminal's cursor-key mode, xterm's modifier encoding,
 * the control-code table — has to be answered here instead. Being a plain module also makes
 * the encoding testable in this package's DOM-less test run.
 */

/** The sticky modifiers the key bar can arm; a phone keyboard has neither key. */
export interface TerminalModifiers {
  ctrl: boolean;
  alt: boolean;
}

export const NO_MODIFIERS: TerminalModifiers = { ctrl: false, alt: false };

export function hasModifier(mods: TerminalModifiers): boolean {
  return mods.ctrl || mods.alt;
}

/** xterm's modifier parameter: 1 + shift(1) + alt(2) + ctrl(4). 1 is "no modifiers". */
function modifierParam(mods: TerminalModifiers): number {
  return 1 + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
}

export type ArrowKey = "up" | "down" | "left" | "right";

const ARROW_FINAL: Record<ArrowKey, string> = { up: "A", down: "B", right: "C", left: "D" };

/**
 * An arrow press. An unmodified arrow follows the terminal's current cursor-key mode —
 * full-screen apps and readline prompts switch to SS3 (`ESC O A`) and read the CSI form as
 * literal text, which is how a hand-rolled arrow button ends up typing `[A` into vim — while
 * a modified arrow is always CSI with a parameter, in both modes.
 */
export function arrowSequence(
  key: ArrowKey,
  mods: TerminalModifiers,
  applicationCursorKeys: boolean,
): string {
  const final = ARROW_FINAL[key];
  const param = modifierParam(mods);
  if (param !== 1) return `\x1b[1;${param}${final}`;
  return applicationCursorKeys ? `\x1bO${final}` : `\x1b[${final}`;
}

/** Ctrl pairings that are not a letter: the C0 codes above and below the alphabet. */
const CONTROL_PUNCTUATION: Record<string, string> = {
  "@": "\x00",
  " ": "\x00",
  "[": "\x1b",
  "\\": "\x1c",
  "]": "\x1d",
  "^": "\x1e",
  _: "\x1f",
  "?": "\x7f",
};

/** Ctrl+<char> as the byte a keyboard would have sent, or null where no pairing exists. */
export function controlCode(char: string): string | null {
  if (char.length !== 1) return null;
  const lower = char.toLowerCase();
  if (lower >= "a" && lower <= "z") return String.fromCharCode(lower.charCodeAt(0) - 96);
  return CONTROL_PUNCTUATION[char] ?? null;
}

/**
 * What an armed modifier does to the characters typed after it.
 *
 * Only a lone character can carry Ctrl. Anything longer — a paste, an IME commit, an escape
 * sequence xterm produced itself — passes through untouched rather than collapsing into a
 * single control byte, which is the difference between "Ctrl armed, then paste" doing
 * nothing surprising and it sending one stray ^V.
 *
 * A pairing with no control code (Ctrl+1) sends the plain character, matching what a
 * physical keyboard does.
 */
export function applyModifiers(data: string, mods: TerminalModifiers): string {
  if (!hasModifier(mods)) return data;
  let out = data;
  if (mods.ctrl) out = controlCode(data) ?? data;
  if (mods.alt) out = `\x1b${out}`;
  return out;
}
