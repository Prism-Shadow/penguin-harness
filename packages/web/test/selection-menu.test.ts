/**
 * lib/selection-menu.ts: the rules behind the conversation's menu for selected text.
 *
 * Which gestures it takes matters as much in the negative as in the positive: everything it
 * declines keeps the browser's own menu, so a rule that took a touch press-and-hold, a
 * right-click in a field, or a selection that runs into the composer would take a menu away
 * from someone who needed it. The excerpt half pins what reaches the model: the blockquote
 * the message carries, and the label the chip shows instead of it.
 */
import { describe, expect, it } from "vitest";
import {
  EXCERPT_LABEL_CHARS,
  SELECTION_MENU_ITEMS,
  excerptBlockquote,
  excerptLabel,
  excerptReference,
  normalizeExcerpt,
  opensSelectionMenu,
  selectionEndAnchor,
} from "../src/lib/selection-menu";
import type { SelectionMenuRequest } from "../src/lib/selection-menu";

/** A right-click on a selection of reply text: the case the menu exists for. */
const REQUEST: SelectionMenuRequest = {
  selectedText: "npm run build",
  rangeCount: 1,
  firstRangeInStream: true,
  pointerType: "mouse",
  onEditable: false,
};

describe("opensSelectionMenu", () => {
  it("takes a secondary click on a selection inside the stream", () => {
    expect(opensSelectionMenu(REQUEST)).toBe(true);
  });

  it("takes the keyboard's request too, which names no pointer", () => {
    expect(opensSelectionMenu({ ...REQUEST, pointerType: "" })).toBe(true);
  });

  it("leaves a touch or pen press-and-hold to the OS selection menu", () => {
    expect(opensSelectionMenu({ ...REQUEST, pointerType: "touch" })).toBe(false);
    expect(opensSelectionMenu({ ...REQUEST, pointerType: "pen" })).toBe(false);
  });

  it("leaves the browser's menu alone when nothing, or only whitespace, is selected", () => {
    expect(opensSelectionMenu({ ...REQUEST, selectedText: "" })).toBe(false);
    expect(opensSelectionMenu({ ...REQUEST, selectedText: " \n\t " })).toBe(false);
  });

  it("declines a selection that runs out of the stream, into the composer for one", () => {
    expect(opensSelectionMenu({ ...REQUEST, firstRangeInStream: false })).toBe(false);
  });

  it("declines a selection of several ranges, even with the first one inside the stream", () => {
    // Firefox's Ctrl+drag builds one: the text read from such a selection is every range's,
    // so a second range in the composer would ride into the clipboard and into the excerpt,
    // and the highlight put back afterwards could only be the one range that was captured.
    expect(opensSelectionMenu({ ...REQUEST, rangeCount: 2 })).toBe(false);
    expect(opensSelectionMenu({ ...REQUEST, rangeCount: 0 })).toBe(false);
  });

  it("declines a gesture on a field, whose own menu (paste, spelling) belongs there", () => {
    expect(opensSelectionMenu({ ...REQUEST, onEditable: true })).toBe(false);
  });
});

describe("SELECTION_MENU_ITEMS", () => {
  it("is Copy, then Add to conversation", () => {
    expect(SELECTION_MENU_ITEMS).toEqual(["copy", "addToConversation"]);
  });
});

describe("selectionEndAnchor", () => {
  const box = (top: number, left: number, right: number) => ({
    top,
    bottom: top + 20,
    left,
    right,
  });

  it("hangs a keyboard-opened menu at the end of the selection's last line", () => {
    // Two lines: the menu belongs at the right edge of the second, where a caret would sit.
    expect(selectionEndAnchor([box(100, 40, 600), box(120, 40, 230)], box(100, 40, 600))).toEqual({
      top: 120,
      bottom: 140,
      left: 230,
      right: 230,
    });
  });

  it("falls back to the bounding box when the range reports no line boxes", () => {
    expect(selectionEndAnchor([], box(300, 10, 90))).toEqual({
      top: 300,
      bottom: 320,
      left: 90,
      right: 90,
    });
  });
});

describe("normalizeExcerpt", () => {
  it("drops what a drag picks up at either end, and nothing in between", () => {
    expect(normalizeExcerpt("\n  \n  indented line\n\nnext\n  \n")).toBe("  indented line\n\nnext");
  });

  it("makes every line ending a newline", () => {
    expect(normalizeExcerpt("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

describe("excerptBlockquote", () => {
  it("quotes every line, and keeps a blank line inside the quote", () => {
    expect(excerptBlockquote("first\n\n  second")).toBe("> first\n>\n>   second");
  });
});

describe("excerptLabel", () => {
  it("keeps a short excerpt whole, on one line", () => {
    expect(excerptLabel("fix the\n  build")).toBe("fix the build");
  });

  it("cuts a long excerpt after its first characters, with an ellipsis", () => {
    const long = "The build fails because the server bundle imports a type-only module.";
    const label = excerptLabel(long);
    expect(label.endsWith("…")).toBe(true);
    expect([...label].length).toBeLessThanOrEqual(EXCERPT_LABEL_CHARS + 1);
    expect(long.startsWith(label.slice(0, -1))).toBe(true);
  });

  it("counts characters, not UTF-16 units, so a cut never splits one", () => {
    const label = excerptLabel("中".repeat(EXCERPT_LABEL_CHARS) + "文😀😀");
    expect(label).toBe(`${"中".repeat(EXCERPT_LABEL_CHARS)}…`);
    expect(excerptLabel("😀".repeat(EXCERPT_LABEL_CHARS))).toBe("😀".repeat(EXCERPT_LABEL_CHARS));
  });
});

describe("excerptReference", () => {
  it("stages the normalized excerpt and carries it into the message as a blockquote", () => {
    expect(excerptReference("\nRun the migration first.\nThen restart.\n")).toEqual({
      kind: "excerpt",
      excerpt: "Run the migration first.\nThen restart.",
      text: "> Run the migration first.\n> Then restart.",
    });
  });
});
