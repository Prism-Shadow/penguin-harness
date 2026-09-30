/**
 * The library frame's height rule: the board, what overflows it, every floating overlay, and
 * the panel of a covering one — and back down when they close.
 */
import { describe, expect, it } from "vitest";
import { coversViewport, FRAME_HEIGHT_OPTIONS, frameHeight } from "../src/library/frame-height";

const main = { bottom: 400, contentBottom: 380 };
const opts = { margin: 10, dialogMin: 560 };

describe("frameHeight", () => {
  it("is the board's box when nothing floats over it", () => {
    expect(frameHeight(main, [], opts)).toBe(400);
    expect(frameHeight({ bottom: 400.2, contentBottom: 0 }, [], opts)).toBe(401);
  });

  it("follows content that overflows the board, with the margin", () => {
    // A dropdown opened inside the board, absolutely positioned below its trigger.
    expect(frameHeight({ bottom: 400, contentBottom: 520 }, [], opts)).toBe(530);
  });

  it("follows a floating overlay's bottom, with the margin", () => {
    const menu = { bottom: 610, covers: false, panelHeight: 0 };
    expect(frameHeight(main, [menu], opts)).toBe(620);
    // One that fits inside the board changes nothing.
    expect(frameHeight(main, [{ bottom: 200, covers: false, panelHeight: 0 }], opts)).toBe(400);
    // Several: the lowest wins.
    const toasts = [
      { bottom: 60, covers: false, panelHeight: 0 },
      { bottom: 120, covers: false, panelHeight: 0 },
    ];
    expect(frameHeight({ bottom: 90, contentBottom: 80 }, toasts, opts)).toBe(130);
  });

  it("gives a covering overlay its panel plus margins, and never less than the dialog floor", () => {
    const backdrop = { bottom: 400, covers: true, panelHeight: 300 };
    expect(frameHeight(main, [backdrop], opts)).toBe(560);
    const tall = { bottom: 400, covers: true, panelHeight: 700 };
    expect(frameHeight(main, [tall], opts)).toBe(720);
    // A drawer whose panel spans the viewport counts only what is inside the panel.
    expect(frameHeight(main, [{ bottom: 400, covers: true, panelHeight: 0 }], opts)).toBe(560);
  });

  it("shrinks back to the board once the overlays are gone", () => {
    const withMenu = frameHeight(main, [{ bottom: 900, covers: false, panelHeight: 0 }], opts);
    expect(withMenu).toBe(910);
    expect(frameHeight(main, [], opts)).toBe(400);
  });

  it("ships with a small margin and a dialog floor of 560", () => {
    expect(FRAME_HEIGHT_OPTIONS).toEqual({ margin: 16, dialogMin: 560 });
  });
});

describe("coversViewport", () => {
  it("is a box from the top of the viewport to its bottom, give or take a pixel", () => {
    expect(coversViewport({ top: 0, bottom: 480 }, 480)).toBe(true);
    expect(coversViewport({ top: 1, bottom: 479 }, 480)).toBe(true);
    expect(coversViewport({ top: 40, bottom: 480 }, 480)).toBe(false);
    expect(coversViewport({ top: 0, bottom: 300 }, 480)).toBe(false);
  });
});
