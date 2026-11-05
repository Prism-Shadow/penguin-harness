/**
 * The shortcut recorder's state machine, pure: `idle → recording → idle`. The settings page's
 * recorder button feeds it every keydown while recording and acts on what comes back — a
 * committed chord (bind), a committed null (unbind), or nothing yet.
 */
import { chordOf, codeFromKey, isBindableChord, isModifierCode } from "./chord";
import type { Chord, KeyLike, Platform } from "./types";

export type RecorderNotice = "needsModifier";

export type RecorderState =
  | { phase: "idle" }
  | {
      phase: "recording";
      /** The modifiers held so far, previewed as "⌘…" / "Ctrl+…"; null while none is held. */
      preview: Chord | null;
      notice: RecorderNotice | null;
    };

export interface RecorderStep {
  state: RecorderState;
  /** Absent = nothing committed; null = unbind; a chord = bind. */
  commit?: Chord | null;
}

export const RECORDER_IDLE: RecorderState = { phase: "idle" };

export function recorderStart(): RecorderState {
  return { phase: "recording", preview: null, notice: null };
}

/** The modifiers an event holds, as a code-less chord, with the platform's Mod mapping. */
function modifiersOf(e: KeyLike, platform: Platform): Chord | null {
  const chord: Chord =
    platform === "mac"
      ? { code: "", mod: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey }
      : { code: "", mod: e.ctrlKey, ctrl: false, alt: e.altKey, shift: e.shiftKey };
  return chord.mod || chord.ctrl || chord.alt || chord.shift ? chord : null;
}

/**
 * One keydown while recording. Escape alone cancels; Backspace or Delete alone unbinds; a
 * modifier-only press previews; a key without a real modifier (Mod, Ctrl, Alt off a Mac; Shift
 * alone is typing) that is not an F key is refused with a notice, since a global chord on it
 * would steal typing from every input; anything else commits.
 */
export function recorderStep(state: RecorderState, e: KeyLike, platform: Platform): RecorderStep {
  if (state.phase !== "recording") return { state };
  if (e.repeat === true || e.isComposing === true) return { state };
  const code = e.code !== "" ? e.code : codeFromKey(e.key);
  if (code === "") return { state };
  if (isModifierCode(code)) {
    return { state: { phase: "recording", preview: modifiersOf(e, platform), notice: null } };
  }
  const bare = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
  if (bare && code === "Escape") return { state: RECORDER_IDLE };
  if (bare && (code === "Backspace" || code === "Delete"))
    return { state: RECORDER_IDLE, commit: null };
  const chord = chordOf(e, platform);
  if (chord === null) return { state }; // Meta on Windows/Linux belongs to the OS
  if (!isBindableChord(chord, platform)) {
    return { state: { phase: "recording", preview: null, notice: "needsModifier" } };
  }
  return { state: RECORDER_IDLE, commit: chord };
}

/** A modifier was released without a key: the preview goes back to empty. */
export function recorderRelease(state: RecorderState): RecorderState {
  if (state.phase !== "recording" || state.preview === null) return state;
  return { ...state, preview: null };
}
