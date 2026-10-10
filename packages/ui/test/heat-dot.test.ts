/**
 * The heat mark, as a page paints it.
 *
 * - Given a position on a stop (0, 1/3, 2/3, 1), the mark is that stop's colour itself.
 * - Given a position between two stops, the mark mixes exactly those two in OKLCH, and the cooler
 *   one's share falls as the position rises — the colour only ever moves towards the hot end.
 * - Given a position outside 0–1, the mark clamps to the nearer end.
 * - Beside its figure the dot is decoration; standing alone it names itself.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { HEAT_STOPS, HeatDot, heatColor } from "../src/components/icons/heat-dot/heat-dot";
import { classTokens, renderStatic } from "../src/testing";

/** What a heatColor() asks for: the two stops it mixes and the cooler one's share. */
function reading(css: string): { cool: string; hot: string; share: number } {
  const stop = /^var\((--ui-heat-\d)\)$/.exec(css);
  if (stop !== null) return { cool: stop[1]!, hot: stop[1]!, share: 100 };
  const mix =
    /^color-mix\(in oklch, var\((--ui-heat-\d)\) ([\d.]+)%, var\((--ui-heat-\d)\)\)$/.exec(css);
  if (mix === null) throw new Error(`not a heat colour: ${css}`);
  return { cool: mix[1]!, share: Number(mix[2]), hot: mix[3]! };
}

describe("heatColor", () => {
  it("is a stop's own colour on each stop", () => {
    expect([0, 1 / 3, 2 / 3, 1].map(heatColor)).toEqual(HEAT_STOPS.map((name) => `var(${name})`));
  });

  it("mixes the two stops around a position in OKLCH, moving only towards the hot end", () => {
    let previous = { segment: 0, share: 100 };
    for (let i = 1; i < 300; i++) {
      if (i % 100 === 0) continue;
      const { cool, hot, share } = reading(heatColor(i / 300));
      const segment = HEAT_STOPS.indexOf(cool as (typeof HEAT_STOPS)[number]);
      expect(HEAT_STOPS[segment + 1]).toBe(hot);
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThan(100);
      // Within a segment the cooler stop's share only falls; a new segment starts the next pair.
      if (segment === previous.segment) expect(share).toBeLessThan(previous.share);
      else expect(segment).toBe(previous.segment + 1);
      previous = { segment, share };
    }
    expect(reading(heatColor(0.5))).toEqual({ cool: HEAT_STOPS[1], hot: HEAT_STOPS[2], share: 50 });
  });

  it("clamps a position outside the ramp to its nearer end", () => {
    expect(heatColor(-0.4)).toBe(heatColor(0));
    expect(heatColor(7)).toBe(heatColor(1));
  });
});

describe("HeatDot", () => {
  it("is a round 8px disc painted at its position", () => {
    const html = renderStatic(createElement(HeatDot, { t: 0.5 }));
    expect(classTokens(html)).toContain("rounded-full");
    expect(html).toContain("width:8px;height:8px");
    expect(html).toContain(`background-color:${heatColor(0.5)}`);
  });

  it("is decoration beside its figure, and an image when it names itself", () => {
    const quiet = renderStatic(createElement(HeatDot, { t: 0 }));
    expect(quiet).toContain('aria-hidden="true"');
    expect(quiet).not.toContain("role=");
    const named = renderStatic(createElement(HeatDot, { t: 1, label: "Very high price" }));
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Very high price"');
    expect(named).not.toContain("aria-hidden");
  });
});
