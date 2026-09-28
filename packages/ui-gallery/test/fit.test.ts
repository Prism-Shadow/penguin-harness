/**
 * The fitting rule for compositions designed at the app's width: laid out at that width, scaled
 * down to the card, never up, and shown unscaled wherever a pixel-for-pixel picture is wanted.
 */
import { describe, expect, it } from "vitest";
import { APP_COLUMN_WIDTH, APP_WINDOW_WIDTH } from "../../ui/src/module";
import { EMBED_PADDING, embedWidth, fitScale, fittedHeight, naturalWidth } from "../src/lib/fit";

describe("naturalWidth", () => {
  it("is the declared viewport, or null for a composition that reflows to its card", () => {
    expect(naturalWidth({ viewport: APP_WINDOW_WIDTH })).toBe(1280);
    expect(naturalWidth({})).toBeNull();
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(naturalWidth({ viewport: bad }), String(bad)).toBeNull();
    }
  });

  it("puts the main column beside the 18rem sidebar at the default 18 px root", () => {
    expect(APP_COLUMN_WIDTH).toBe(1280 - 324);
  });
});

describe("fitScale", () => {
  it("shrinks a composition to a narrower card", () => {
    expect(fitScale(1280, 704)).toBeCloseTo(0.55, 5);
    expect(fitScale(956, 704)).toBeCloseTo(704 / 956, 10);
  });

  it("never scales up, and holds at 1 until the card has been measured", () => {
    expect(fitScale(956, 1200)).toBe(1);
    expect(fitScale(956, 956)).toBe(1);
    expect(fitScale(956, 0)).toBe(1);
    expect(fitScale(0, 704)).toBe(1);
  });

  it("gives the box the composition's height at that scale, rounded up so nothing is cut", () => {
    expect(fittedHeight(702, 0.55)).toBe(387);
    expect(fittedHeight(640, 1)).toBe(640);
  });
});

describe("embedWidth", () => {
  it("adds the embed's padding, which the edge-to-edge hero does not have", () => {
    expect(embedWidth("navigation", 1280)).toBe(1280 + 2 * EMBED_PADDING);
    expect(embedWidth("hero", 1280)).toBe(1280);
  });
});
