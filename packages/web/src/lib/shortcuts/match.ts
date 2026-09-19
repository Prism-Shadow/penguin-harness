/**
 * Matching an event against the resolved keymap. Pure: the caller supplies the keymap, the
 * scopes that currently hold focus and the platform, and gets back a command id or null.
 */
import { chordEquals, chordOf } from "./chord";
import { usCharacter } from "./format";
import { SHORTCUT_COMMANDS } from "./registry";
import type { Chord, CommandId, KeyLike, Keymap, Platform, ShortcutScope } from "./types";

/**
 * The command the event runs among the commands whose scope is in `scopes`: a focus scope
 * (terminal, editor) beats global, and among equals the registry order decides. Deterministic,
 * which is what lets a conflicting user binding be a warning rather than an error.
 */
export function matchShortcut(
  e: KeyLike,
  keymap: Keymap,
  scopes: readonly ShortcutScope[],
  platform: Platform,
): CommandId | null {
  const chord = chordOf(e, platform);
  if (chord === null) return null;
  let global: CommandId | null = null;
  for (const cmd of SHORTCUT_COMMANDS) {
    if (!scopes.includes(cmd.scope)) continue;
    if (!chordEquals(keymap.get(cmd.id) ?? null, chord)) continue;
    if (cmd.scope !== "global") return cmd.id;
    global ??= cmd.id;
  }
  return global;
}

/** One command's own test, for a surface that owns the action (the editors' save). */
export function isShortcut(e: KeyLike, keymap: Keymap, id: CommandId, platform: Platform): boolean {
  const bound = keymap.get(id) ?? null;
  if (bound === null) return false;
  return chordEquals(chordOf(e, platform), bound);
}

/**
 * Defaults are authored in US key positions. Where the browser exposes the keyboard layout
 * (`navigator.keyboard.getLayoutMap()`, a `code → character` map), a default whose key types a
 * different character than it does on US is moved to the key that types the US character, so
 * "the S key" means the key that types S: `KeyZ` on AZERTY for W, `Semicolon` on US-Dvorak for
 * S. Every code in the map is a candidate — Dvorak puts letters on the punctuation positions.
 * User-recorded chords are physical and are never relocated.
 *
 * One layout the map cannot describe: macOS's "Dvorak – QWERTY ⌘" input source types Dvorak
 * but switches to QWERTY while ⌘ is held, so relocation moves ⌘S to `Semicolon` there while the
 * user's ⌘S arrives on `KeyS`. That source wants relocation off for Mod chords; nothing exposes
 * it, so it is not handled.
 */
export function relocateChord(chord: Chord, layout: ReadonlyMap<string, string>): Chord {
  const wanted = usCharacter(chord.code);
  if (wanted === null) return chord;
  const produced = layout.get(chord.code);
  if (produced === undefined || produced.toLowerCase() === wanted) return chord;
  for (const [code, char] of layout) {
    if (char.toLowerCase() === wanted) return { ...chord, code };
  }
  return chord;
}
