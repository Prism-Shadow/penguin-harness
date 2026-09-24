/**
 * Keyboard movement through the address bar's history suggestions
 * (features/builtin-browser/suggestion-nav.ts): the arrows cycle through the rows and back to
 * the typed text, like a browser's address bar, and every other key stays the field's.
 */
import { describe, expect, it } from "vitest";
import { NO_HIGHLIGHT, moveHighlight } from "../src/features/builtin-browser/suggestion-nav";

describe("moveHighlight", () => {
  it("walks down the rows and back to the typed text", () => {
    const seen: number[] = [];
    let at = NO_HIGHLIGHT;
    for (let i = 0; i < 4; i += 1) {
      at = moveHighlight(at, 3, "ArrowDown") ?? at;
      seen.push(at);
    }
    expect(seen).toEqual([0, 1, 2, NO_HIGHLIGHT]);
  });

  it("walks up from the typed text to the last row", () => {
    expect(moveHighlight(NO_HIGHLIGHT, 3, "ArrowUp")).toBe(2);
    expect(moveHighlight(0, 3, "ArrowUp")).toBe(NO_HIGHLIGHT);
    expect(moveHighlight(2, 3, "ArrowUp")).toBe(1);
  });

  it("leaves Home, End, Enter and letters to the text field", () => {
    for (const key of ["Home", "End", "Enter", "a", "Tab"]) {
      expect(moveHighlight(0, 3, key)).toBeNull();
    }
  });

  it("has nothing to move through without rows", () => {
    expect(moveHighlight(NO_HIGHLIGHT, 0, "ArrowDown")).toBeNull();
  });

  it("recovers from a highlight past a list that shrank", () => {
    expect(moveHighlight(7, 3, "ArrowDown")).toBe(NO_HIGHLIGHT);
    expect(moveHighlight(7, 3, "ArrowUp")).toBe(1);
  });
});
