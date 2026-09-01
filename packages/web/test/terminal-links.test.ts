/**
 * Opening a link a terminal printed (features/terminal/terminal-links.ts).
 *
 * Terminal output is a program's, not the reader's, so the scheme check is the load-bearing
 * part: a `javascript:` or `data:` link is as easy to print as an `https:` one, and this is
 * the sink xterm's own documentation warns to validate. The other half is that a real URL is
 * opened DIRECTLY — the addon's built-in handler opens a blank window first and navigates
 * it, which inside the desktop shell became a link to `about:blank`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLICK_SLOP_PX,
  LinkClickTracker,
  isOpenableLink,
  openTerminalLink,
  positionFromPointer,
  rangeContains,
} from "../src/features/terminal/terminal-links";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Records what window.open was asked to do. */
function stubWindowOpen(): { calls: [string, string, string][] } {
  const calls: [string, string, string][] = [];
  vi.stubGlobal("window", {
    open: (url: string, target: string, features: string) => {
      calls.push([url, target, features]);
      return null;
    },
  });
  return { calls };
}

describe("isOpenableLink", () => {
  it("accepts the two schemes a page may be at", () => {
    expect(isOpenableLink("https://github.com/o/r/pull/555")).toBe(true);
    expect(isOpenableLink("http://localhost:7364/")).toBe(true);
  });

  it("refuses everything a program could print to make the terminal act", () => {
    for (const uri of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vscode://file/etc/passwd",
      "about:blank",
      "",
      "github.com/o/r",
    ]) {
      expect(isOpenableLink(uri)).toBe(false);
    }
  });
});

describe("openTerminalLink", () => {
  it("opens the URL itself, in one step, with no opener", () => {
    // The regression: the addon's own handler opens `window.open()` with NO url — a blank
    // window — and then assigns location.href. The shell routes by the url it is handed, so
    // that one arrived as about:blank and the real link never opened.
    const { calls } = stubWindowOpen();
    openTerminalLink("https://github.com/o/r/pull/555");
    expect(calls).toEqual([["https://github.com/o/r/pull/555", "_blank", "noopener,noreferrer"]]);
  });

  it("opens nothing at all for a scheme it refuses", () => {
    const { calls } = stubWindowOpen();
    openTerminalLink("javascript:alert(1)");
    openTerminalLink("about:blank");
    expect(calls).toEqual([]);
  });
});

describe("positionFromPointer", () => {
  const screen = { left: 10, top: 20, width: 800, height: 480 }; // 80 × 24 cells of 10 × 20
  const grid = { cols: 80, rows: 24, viewportY: 0 };

  it("maps a pointer to the 1-based cell under it, adding the scroll offset to the row", () => {
    expect(positionFromPointer({ x: 10, y: 20 }, screen, grid)).toEqual({ x: 1, y: 1 });
    expect(positionFromPointer({ x: 35, y: 45 }, screen, grid)).toEqual({ x: 3, y: 2 });
    expect(positionFromPointer({ x: 809, y: 499 }, screen, grid)).toEqual({ x: 80, y: 24 });
    // A scrolled viewport: the row is the buffer line xterm's providers report ranges in.
    expect(positionFromPointer({ x: 35, y: 45 }, screen, { ...grid, viewportY: 18 })).toEqual({
      x: 3,
      y: 20,
    });
  });

  it("answers null off the grid, and for a grid that has no size yet", () => {
    expect(positionFromPointer({ x: 9, y: 20 }, screen, grid)).toBeNull();
    expect(positionFromPointer({ x: 10, y: 500 }, screen, grid)).toBeNull();
    expect(positionFromPointer({ x: 10, y: 20 }, { ...screen, width: 0 }, grid)).toBeNull();
    expect(positionFromPointer({ x: 10, y: 20 }, screen, { ...grid, cols: 0 })).toBeNull();
  });
});

describe("rangeContains", () => {
  it("is inclusive at both ends and treats a wrapped link as one interval, like xterm", () => {
    const range = { start: { x: 78, y: 5 }, end: { x: 3, y: 6 } }; // wraps from row 5 into row 6
    expect(rangeContains(range, 80, { x: 78, y: 5 })).toBe(true);
    expect(rangeContains(range, 80, { x: 80, y: 5 })).toBe(true);
    expect(rangeContains(range, 80, { x: 1, y: 6 })).toBe(true);
    expect(rangeContains(range, 80, { x: 3, y: 6 })).toBe(true);
    expect(rangeContains(range, 80, { x: 77, y: 5 })).toBe(false);
    expect(rangeContains(range, 80, { x: 4, y: 6 })).toBe(false);
  });
});

describe("LinkClickTracker", () => {
  const URL = "https://github.com/o/r/pull/555";
  const range = { start: { x: 3, y: 41 }, end: { x: 9, y: 41 } };
  const inside = { x: 5, y: 41 };
  const outside = { x: 20, y: 41 };
  const tracker = () => new LinkClickTracker(() => 80);

  it("opens the hovered link on a click that stays inside it", () => {
    const t = tracker();
    t.hover(URL, range);
    t.down(inside, 100, 100);
    expect(t.up(inside, 101, 100)).toBe(URL);
  });

  it("keeps the link across xterm's leave — a redraw of a still-present link", () => {
    // The regression this exists for: xterm forgets the link on every redraw, and a
    // full-screen program redraws between any human mousedown and mouseup.
    const t = tracker();
    t.hover(URL, range);
    t.down(inside, 100, 100);
    t.leave();
    t.leave();
    expect(t.up(inside, 100, 100)).toBe(URL);
  });

  it("forgets the link once the pointer is seen outside it", () => {
    const t = tracker();
    t.hover(URL, range);
    t.move(outside);
    t.down(inside, 100, 100);
    expect(t.up(inside, 100, 100)).toBeNull();
    // Off the grid entirely counts as outside too.
    t.hover(URL, range);
    t.move(null);
    t.down(inside, 100, 100);
    expect(t.up(inside, 100, 100)).toBeNull();
  });

  it("a drag is a selection, not a click, however short", () => {
    const t = tracker();
    t.hover(URL, range);
    t.down(inside, 100, 100);
    expect(t.up(inside, 100 + CLICK_SLOP_PX + 1, 100)).toBeNull();
    t.down(inside, 100, 100);
    expect(t.up(inside, 100, 100 - CLICK_SLOP_PX)).toBe(URL); // within the slop: still a click
  });

  it("needs both ends of the click on the link", () => {
    const t = tracker();
    t.hover(URL, range);
    t.down(outside, 100, 100);
    expect(t.up(inside, 100, 100)).toBeNull();
    t.down(inside, 100, 100);
    expect(t.up(outside, 100, 100)).toBeNull();
    t.down(null, 100, 100);
    expect(t.up(inside, 100, 100)).toBeNull();
  });

  it("consumes the down: a mouseup never opens on the strength of an earlier click", () => {
    const t = tracker();
    t.hover(URL, range);
    t.down(inside, 100, 100);
    expect(t.up(inside, 100, 100)).toBe(URL);
    expect(t.up(inside, 100, 100)).toBeNull();
  });

  it("follows the most recently hovered link", () => {
    const t = tracker();
    const other = { start: { x: 3, y: 42 }, end: { x: 9, y: 42 } };
    t.hover(URL, range);
    t.hover("https://example.com/x", other);
    t.down({ x: 5, y: 42 }, 100, 100);
    expect(t.up({ x: 5, y: 42 }, 100, 100)).toBe("https://example.com/x");
  });
});
