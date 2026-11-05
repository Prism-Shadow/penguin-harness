/**
 * The ring gauge (src/components/charts/ring): named by its caller or hidden, arcs laid clockwise
 * from twelve o'clock as shares of `max` and never past a full circle, a lone partial arc
 * round-capped, the track in the grid's line or the ring's own ink faded, and the tone as a
 * token ink.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Ring, ringArcs } from "../src/components/charts/ring/ring";
import { classTokens, renderStatic } from "../src/testing";

type Props = Parameters<typeof Ring>[0];
const ring = (props: Props) => renderStatic(createElement(Ring, props));

describe("Ring", () => {
  it("is an image named by the caller, or decoration without a name", () => {
    const named = ring({ segments: [{ value: 0.4 }], max: 1, label: "$4 / $10 · 40%" });
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="$4 / $10 · 40%"');
    expect(named).toContain('data-tooltip="$4 / $10 · 40%"');
    const bare = ring({ segments: [{ value: 0.4 }], max: 1 });
    expect(bare).toContain('aria-hidden="true"');
    expect(bare).not.toContain("role=");
    expect(classTokens(bare)).toContain("ui-chart");
  });

  it("lays arcs clockwise as shares of max, filling the ring when they add up to more", () => {
    const c = 80;
    expect(ringArcs([{ value: 1 }, { value: 2 }], 8, c)).toEqual([
      { index: 0, length: 10, offset: -0 },
      { index: 1, length: 20, offset: -10 },
    ]);
    const over = ringArcs([{ value: 3 }, { value: 1 }], 2, c);
    expect(over.map((a) => a.length)).toEqual([60, 20]);
    // Nothing to draw: an empty reading, a zero segment, a zero max with nothing in it.
    expect(ringArcs([{ value: 0 }], 1, c)).toEqual([]);
    expect(ringArcs([], 0, c)).toEqual([]);
  });

  it("round-caps a lone arc that does not close the ring, and nothing else", () => {
    expect(ring({ segments: [{ value: 0.5 }], max: 1 })).toContain('stroke-linecap="round"');
    expect(ring({ segments: [{ value: 1 }], max: 1 })).not.toContain("stroke-linecap");
    expect(ring({ segments: [{ value: 0.2 }, { value: 0.3 }], max: 1 })).not.toContain(
      "stroke-linecap",
    );
  });

  it("draws its track in the grid's line, or in its own ink faded", () => {
    const grid = ring({ segments: [], max: 1 });
    expect(grid).toContain('data-part="grid"');
    expect(classTokens(grid)).toContain("text-chart-grid");
    expect(grid).not.toContain('data-part="series"');
    const faded = ring({ segments: [], max: 1, trackOpacity: 0.25 });
    expect(faded).toContain('stroke-opacity="0.25"');
    expect(classTokens(faded)).not.toContain("text-chart-grid");
  });

  it("inks itself in its tone's token, or in the ink around it", () => {
    expect(classTokens(ring({ segments: [], max: 1, tone: "danger" }))).toContain(
      "text-tone-danger-fg",
    );
    const own = ring({ segments: [{ value: 0.5, paint: { role: "output" } }], max: 1 });
    expect(own).toContain("var(--ui-chart-output)");
    expect(own).not.toMatch(/gray-|red-|dark:/);
  });
});
