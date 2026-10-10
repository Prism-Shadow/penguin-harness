/**
 * The recorder's state machine (src/lib/shortcuts/recorder.ts): a modifier previews, Escape
 * cancels, Backspace clears, a bare letter is refused with a notice, a bare F key and any
 * modifier chord commit.
 */
import { describe, expect, it } from "vitest";
import {
  RECORDER_IDLE,
  recorderRelease,
  recorderStart,
  recorderStep,
} from "../src/lib/shortcuts/recorder";
import type { KeyLike } from "../src/lib/shortcuts/types";

function key(overrides: Partial<KeyLike> & { code: string }): KeyLike {
  return { key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides };
}

describe("recorderStep", () => {
  it("does nothing while idle", () => {
    expect(recorderStep(RECORDER_IDLE, key({ code: "KeyW", ctrlKey: true }), "linux")).toEqual({
      state: RECORDER_IDLE,
    });
  });

  it("previews the modifiers held so far, with the platform's Mod mapping, and clears on release", () => {
    const held = recorderStep(recorderStart(), key({ code: "MetaLeft", metaKey: true }), "mac");
    expect(held.state).toEqual({
      phase: "recording",
      preview: { code: "", mod: true, ctrl: false, alt: false, shift: false },
      notice: null,
    });
    expect(held.commit).toBeUndefined();
    const both = recorderStep(
      held.state,
      key({ code: "ShiftLeft", metaKey: true, shiftKey: true }),
      "mac",
    );
    expect(both.state).toMatchObject({ preview: { mod: true, shift: true } });
    // On Linux the Control key IS Mod, and the Super key previews nothing.
    expect(
      recorderStep(recorderStart(), key({ code: "ControlLeft", ctrlKey: true }), "linux").state,
    ).toMatchObject({ preview: { mod: true, ctrl: false } });
    expect(
      recorderStep(recorderStart(), key({ code: "MetaLeft", metaKey: true }), "linux").state,
    ).toMatchObject({ preview: null });
    expect(recorderRelease(held.state)).toEqual(recorderStart());
    expect(recorderRelease(RECORDER_IDLE)).toBe(RECORDER_IDLE);
  });

  it("cancels on Escape and commits an unbind on Backspace or Delete", () => {
    expect(recorderStep(recorderStart(), key({ code: "Escape", key: "Escape" }), "linux")).toEqual({
      state: RECORDER_IDLE,
    });
    expect(recorderStep(recorderStart(), key({ code: "Backspace" }), "linux")).toEqual({
      state: RECORDER_IDLE,
      commit: null,
    });
    expect(recorderStep(recorderStart(), key({ code: "Delete" }), "mac")).toEqual({
      state: RECORDER_IDLE,
      commit: null,
    });
    // With a modifier held they are ordinary chords.
    expect(
      recorderStep(recorderStart(), key({ code: "Escape", ctrlKey: true }), "linux").commit,
    ).toEqual({
      code: "Escape",
      mod: true,
      ctrl: false,
      alt: false,
      shift: false,
    });
  });

  it("refuses typing — a bare key, Shift alone, Option alone on a Mac — and stays recording with a notice", () => {
    const refusedState = { phase: "recording", preview: null, notice: "needsModifier" };
    const refused = recorderStep(recorderStart(), key({ code: "KeyW", key: "w" }), "linux");
    expect(refused).toEqual({ state: refusedState });
    expect(recorderStep(recorderStart(), key({ code: "KeyB", shiftKey: true }), "linux")).toEqual({
      state: refusedState,
    });
    expect(recorderStep(recorderStart(), key({ code: "Enter", shiftKey: true }), "mac")).toEqual({
      state: refusedState,
    });
    expect(recorderStep(recorderStart(), key({ code: "KeyE", altKey: true }), "mac")).toEqual({
      state: refusedState,
    });
    // Alt is a real modifier off a Mac (the design's Alt+W rebinding stays possible).
    expect(
      recorderStep(recorderStart(), key({ code: "KeyW", altKey: true }), "linux").commit,
    ).toEqual({ code: "KeyW", mod: false, ctrl: false, alt: true, shift: false });
    // The notice clears once a modifier is held again.
    expect(
      recorderStep(refused.state, key({ code: "ControlLeft", ctrlKey: true }), "linux").state,
    ).toMatchObject({ notice: null });
  });

  it("commits a bare F key and any modifier chord", () => {
    expect(recorderStep(recorderStart(), key({ code: "F5", key: "F5" }), "linux")).toEqual({
      state: RECORDER_IDLE,
      commit: { code: "F5", mod: false, ctrl: false, alt: false, shift: false },
    });
    expect(
      recorderStep(recorderStart(), key({ code: "KeyW", metaKey: true, altKey: true }), "mac")
        .commit,
    ).toEqual({ code: "KeyW", mod: true, ctrl: false, alt: true, shift: false });
    expect(
      recorderStep(recorderStart(), key({ code: "KeyW", ctrlKey: true }), "linux").commit,
    ).toEqual({
      code: "KeyW",
      mod: true,
      ctrl: false,
      alt: false,
      shift: false,
    });
  });

  it("ignores auto-repeat, IME composition, a missing code and the Super key on Linux", () => {
    const recording = recorderStart();
    expect(
      recorderStep(recording, key({ code: "KeyW", ctrlKey: true, repeat: true }), "linux"),
    ).toEqual({
      state: recording,
    });
    expect(
      recorderStep(recording, key({ code: "KeyW", ctrlKey: true, isComposing: true }), "linux"),
    ).toEqual({
      state: recording,
    });
    expect(recorderStep(recording, key({ code: "", key: "Unidentified" }), "linux")).toEqual({
      state: recording,
    });
    expect(recorderStep(recording, key({ code: "KeyW", metaKey: true }), "windows")).toEqual({
      state: recording,
    });
  });
});
