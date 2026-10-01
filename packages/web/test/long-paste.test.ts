/**
 * A long paste becomes a text-file attachment instead of text in the composer.
 *
 * - Given an ordinary paste (a sentence, a short snippet), it stays text.
 * - Given a paste longer than the character limit, it is attached as a file.
 * - Given a paste of many short lines past the line limit, it is attached as a file even though
 *   it is short in characters.
 * - The attached file is named by the local time of the paste, so a user can tell which paste
 *   it was.
 */
import { describe, expect, it } from "vitest";
import {
  LONG_PASTE_MAX_CHARS,
  LONG_PASTE_MAX_LINES,
  isLongPaste,
  longPasteFileName,
} from "../src/lib/long-paste";

describe("long paste", () => {
  it("an ordinary paste stays text", () => {
    expect(isLongPaste("fix the flaky test in server")).toBe(false);
    expect(isLongPaste("line\n".repeat(LONG_PASTE_MAX_LINES - 1))).toBe(false);
    expect(isLongPaste("x".repeat(LONG_PASTE_MAX_CHARS))).toBe(false);
  });

  it("a paste past the character limit is attached", () => {
    expect(isLongPaste("x".repeat(LONG_PASTE_MAX_CHARS + 1))).toBe(true);
  });

  it("many short lines past the line limit are attached", () => {
    const log = "ok\n".repeat(LONG_PASTE_MAX_LINES);
    expect(log.length).toBeLessThan(LONG_PASTE_MAX_CHARS);
    expect(isLongPaste(log)).toBe(true);
  });

  it("the file is named by the local time of the paste", () => {
    expect(longPasteFileName(new Date(2026, 9, 1, 9, 5, 7))).toBe("pasted-20261001-090507.txt");
  });
});
