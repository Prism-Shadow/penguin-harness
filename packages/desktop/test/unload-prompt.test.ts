/**
 * The shell's question when the window would close or reload over unsaved edits
 * (src/unload-prompt.ts; main.ts shows it on `will-prevent-unload`).
 *
 * - It asks in either language: the same question and the same two buttons, in other words.
 * - Discarding is the first button; keeping the edits is the default and what Escape answers.
 * - "Discard" lets the page go, and a quit in progress goes on.
 * - "Keep editing" keeps the page and calls a quit in progress off, so the next close of the
 *   window is an ordinary one.
 */
import { describe, expect, it } from "vitest";
import {
  UNLOAD_DISCARD,
  UNLOAD_KEEP,
  afterUnloadAnswer,
  unloadPrompt,
} from "../src/unload-prompt.js";

describe("the unload question", () => {
  it("asks in either language: the same question and buttons, in other words", () => {
    const en = unloadPrompt("en", "PenguinHarness");
    const zh = unloadPrompt("zh", "PenguinHarness");
    expect(zh.buttons).toHaveLength(en.buttons!.length);
    expect(zh.message).not.toBe(en.message);
    expect(zh.detail).not.toBe(en.detail);
    zh.buttons!.forEach((label, i) => expect(label).not.toBe(en.buttons![i]));
  });

  it("offers discarding first and keeps the edits by default and on Escape", () => {
    const box = unloadPrompt("en", "PenguinHarness");
    expect(box.buttons?.[UNLOAD_DISCARD]).toBe("Discard changes");
    expect(box.defaultId).toBe(UNLOAD_KEEP);
    expect(box.cancelId).toBe(UNLOAD_KEEP);
  });

  it("lets the page go on discard, and a quit in progress goes on", () => {
    expect(afterUnloadAnswer(UNLOAD_DISCARD, true)).toEqual({ unload: true, quitting: true });
    expect(afterUnloadAnswer(UNLOAD_DISCARD, false)).toEqual({ unload: true, quitting: false });
  });

  it("keeps the page on keep editing, and calls a quit in progress off", () => {
    expect(afterUnloadAnswer(UNLOAD_KEEP, true)).toEqual({ unload: false, quitting: false });
  });
});
