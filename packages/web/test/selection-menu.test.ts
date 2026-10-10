/**
 * The rules behind the conversation's own menu for selected text and web links
 * (lib/selection-menu.ts). Everything the menu declines keeps the browser's own menu.
 *
 * - The menu opens on a secondary click or the keyboard's request over a selection inside the
 *   stream, and declines a touch or pen press-and-hold, an empty or whitespace selection, a
 *   selection running out of the stream or made of several ranges, and a gesture in a field.
 * - A keyboard-opened menu hangs at the end of the selection's last line (or the bounding box
 *   without line boxes), and at a link's first line.
 * - An excerpt is trimmed at both ends with normalized line endings, carried into the message
 *   as a blockquote (blank lines inside kept), and labelled on its chip by its first characters,
 *   cut by characters rather than UTF-16 units.
 * - Only an absolute web address counts as a link for the menu (normalized); a Workspace file,
 *   an anchor, a relative href or another scheme does not. The built-in browser is offered
 *   first only where it can open the link.
 * - On a link the menu shows the link's rows, adding the selection's after them when the
 *   selection rules take it; off a link it opens exactly as the selection rules say.
 */
import { describe, expect, it } from "vitest";
import {
  EXCERPT_LABEL_CHARS,
  excerptBlockquote,
  excerptLabel,
  excerptReference,
  linkAnchor,
  linkMenuItems,
  menuLinkHref,
  normalizeExcerpt,
  opensSelectionMenu,
  selectionEndAnchor,
  streamMenuContent,
} from "../src/lib/selection-menu";
import type { SelectionMenuRequest, StreamMenuRequest } from "../src/lib/selection-menu";

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

describe("menuLinkHref", () => {
  it("takes an absolute web address, normalized by the URL parser", () => {
    expect(menuLinkHref("https://example.com/docs?page=2#intro")).toBe(
      "https://example.com/docs?page=2#intro",
    );
    expect(menuLinkHref("http://localhost:5173")).toBe("http://localhost:5173/");
    expect(menuLinkHref(" HTTPS://Example.COM ")).toBe("https://example.com/");
  });

  it("leaves a Workspace file, an anchor and a relative href alone", () => {
    // These keep their own behaviour: the Files panel, a scroll, or staying put. Resolved
    // against the App's origin they would read as http addresses of the App itself.
    for (const href of ["notes.md", "./src/app.ts", "../README.md", "/home/me/x.txt", "#fn-1"]) {
      expect(menuLinkHref(href)).toBeNull();
    }
  });

  it("offers nothing for another scheme, an emptied href, or none", () => {
    for (const href of ["mailto:a@example.com", "file:///etc/passwd", "ftp://example.com/", ""]) {
      expect(menuLinkHref(href)).toBeNull();
    }
    expect(menuLinkHref(null)).toBeNull();
  });
});

describe("linkMenuItems", () => {
  it("offers the built-in browser first where it can open the link", () => {
    expect(linkMenuItems(true)).toEqual(["openInBuiltinBrowser", "openExternal", "copyLink"]);
  });

  it("leaves it out everywhere else", () => {
    expect(linkMenuItems(false)).toEqual(["openExternal", "copyLink"]);
  });
});

describe("streamMenuContent", () => {
  const LINK = "https://example.com/";
  /** A right-click on a link with nothing selected. */
  const ON_LINK: StreamMenuRequest = {
    selectedText: "",
    rangeCount: 0,
    firstRangeInStream: false,
    pointerType: "mouse",
    onEditable: false,
    linkHref: LINK,
  };

  it("takes a secondary click on a web link, with the link's rows alone", () => {
    expect(streamMenuContent(ON_LINK)).toEqual({ linkHref: LINK, selection: false });
  });

  it("takes the keyboard's request on a focused link too", () => {
    expect(streamMenuContent({ ...ON_LINK, pointerType: "" })).toEqual({
      linkHref: LINK,
      selection: false,
    });
  });

  it("adds the selection's rows after the link's when text in the stream is selected", () => {
    expect(streamMenuContent({ ...REQUEST, linkHref: LINK })).toEqual({
      linkHref: LINK,
      selection: true,
    });
  });

  it("keeps the link's rows when the selection is one the selection rules decline", () => {
    expect(streamMenuContent({ ...REQUEST, linkHref: LINK, firstRangeInStream: false })).toEqual({
      linkHref: LINK,
      selection: false,
    });
  });

  it("opens exactly as before off a link: the selection's rows, or nothing at all", () => {
    expect(streamMenuContent({ ...REQUEST, linkHref: null })).toEqual({
      linkHref: null,
      selection: true,
    });
    expect(streamMenuContent({ ...ON_LINK, linkHref: null })).toBeNull();
  });

  it("leaves a touch or pen press-and-hold on a link to the OS link menu", () => {
    expect(streamMenuContent({ ...ON_LINK, pointerType: "touch" })).toBeNull();
    expect(streamMenuContent({ ...ON_LINK, pointerType: "pen" })).toBeNull();
  });

  it("declines a gesture in a field, link or not", () => {
    expect(streamMenuContent({ ...ON_LINK, onEditable: true })).toBeNull();
  });
});

describe("linkAnchor", () => {
  const box = (top: number, left: number, right: number) => ({
    top,
    bottom: top + 20,
    left,
    right,
  });

  it("drops a keyboard-opened menu from the link's first line", () => {
    // A link wrapped over two lines: the menu hangs under the part where it starts.
    expect(linkAnchor([box(100, 380, 600), box(120, 40, 120)], box(100, 40, 600))).toEqual(
      box(100, 380, 600),
    );
  });

  it("falls back to the bounding box when the link reports no line boxes", () => {
    expect(linkAnchor([], box(300, 10, 90))).toEqual(box(300, 10, 90));
  });
});
