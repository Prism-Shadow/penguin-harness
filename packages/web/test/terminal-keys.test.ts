/**
 * The touch key bar's wire format (terminal-keys.ts): what the bar has to get right because
 * it bypasses xterm's own key handling.
 */
import { describe, expect, it } from "vitest";
import {
  NO_MODIFIERS,
  applyModifiers,
  arrowSequence,
  controlCode,
  hasModifier,
} from "../src/features/terminal/terminal-keys";

const CTRL = { ctrl: true, alt: false };
const ALT = { ctrl: false, alt: true };

describe("arrowSequence", () => {
  it("sends CSI while the terminal is in normal cursor-key mode", () => {
    expect(arrowSequence("up", NO_MODIFIERS, false)).toBe("\x1b[A");
    expect(arrowSequence("down", NO_MODIFIERS, false)).toBe("\x1b[B");
    expect(arrowSequence("right", NO_MODIFIERS, false)).toBe("\x1b[C");
    expect(arrowSequence("left", NO_MODIFIERS, false)).toBe("\x1b[D");
  });

  it("switches to SS3 when a full-screen app turned application cursor keys on", () => {
    // The CSI form would arrive in vim as the literal text "[A".
    expect(arrowSequence("up", NO_MODIFIERS, true)).toBe("\x1bOA");
    expect(arrowSequence("left", NO_MODIFIERS, true)).toBe("\x1bOD");
  });

  it("encodes modifiers as xterm's parameter, in either cursor-key mode", () => {
    expect(arrowSequence("left", CTRL, false)).toBe("\x1b[1;5D");
    expect(arrowSequence("left", ALT, false)).toBe("\x1b[1;3D");
    expect(arrowSequence("right", { ctrl: true, alt: true }, true)).toBe("\x1b[1;7C");
  });
});

describe("controlCode", () => {
  it("maps letters to their C0 code, case-insensitively", () => {
    expect(controlCode("c")).toBe("\x03");
    expect(controlCode("C")).toBe("\x03");
    expect(controlCode("a")).toBe("\x01");
    expect(controlCode("z")).toBe("\x1a");
  });

  it("maps the punctuation pairings a keyboard has", () => {
    expect(controlCode("[")).toBe("\x1b");
    expect(controlCode(" ")).toBe("\x00");
    expect(controlCode("?")).toBe("\x7f");
  });

  it("has no code for an unpaired character or a longer chunk", () => {
    expect(controlCode("1")).toBeNull();
    expect(controlCode("ab")).toBeNull();
    expect(controlCode("")).toBeNull();
  });
});

describe("applyModifiers", () => {
  it("passes data through untouched when nothing is armed", () => {
    expect(hasModifier(NO_MODIFIERS)).toBe(false);
    expect(applyModifiers("ls -la", NO_MODIFIERS)).toBe("ls -la");
  });

  it("composes an armed Ctrl with the next character", () => {
    expect(applyModifiers("c", CTRL)).toBe("\x03");
  });

  it("prefixes an armed Alt with ESC, the way a meta key does", () => {
    expect(applyModifiers("b", ALT)).toBe("\x1bb");
    expect(applyModifiers("c", { ctrl: true, alt: true })).toBe("\x1b\x03");
  });

  it("leaves a multi-character chunk alone under Ctrl", () => {
    // A paste or an IME commit arriving while Ctrl is armed must not collapse into one
    // control byte.
    expect(applyModifiers("hello", CTRL)).toBe("hello");
  });

  it("sends the plain character where the pairing has no control code", () => {
    expect(applyModifiers("1", CTRL)).toBe("1");
  });
});
