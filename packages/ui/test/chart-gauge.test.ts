/**
 * The gauge (src/components/charts/gauge): one reading against a whole, as a figure and a ring.
 *
 * - A gauge is a meter to assistive technology: named, with its bounds, its value and the figure
 *   with its unit as its text (a % hugs the figure, any other unit takes a space).
 * - Without a tone the ring takes the accent and the figure the text ink; with one, both take the
 *   tone's ink.
 * - A ring short of full is one round-capped arc of the share it fills, counted from `min`; a full
 *   one closes with no caps; a reading past either bound fills nothing or everything.
 * - `ring={false}` keeps the meter and the figure without a ring; `lone` sets the figure large.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Gauge, gaugeShare } from "../src/components/charts/gauge/gauge";
import type { GaugeProps } from "../src/components/charts/gauge/gauge";
import { classTokens, renderStatic } from "../src/testing";

const gauge = (props: Partial<GaugeProps> = {}) =>
  renderStatic(
    createElement(Gauge, { value: 37, max: 100, figure: "37", unit: "%", label: "CPU", ...props }),
  );

describe("Gauge", () => {
  it("is a meter with its name, bounds, value and text", () => {
    const html = gauge();
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="CPU"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="37"');
    expect(html).toContain('aria-valuetext="37%"');
    expect(gauge({ value: 320, max: 512, figure: "320", unit: "GB" })).toContain(
      'aria-valuetext="320 GB"',
    );
  });

  it("rings in the accent while fine, and inks figure and ring in its tone when judged", () => {
    const fine = gauge();
    expect(classTokens(fine)).toContain("text-accent");
    expect(fine).not.toMatch(/text-tone-/);
    const danger = gauge({ value: 96, tone: "danger" });
    expect(danger.match(/text-tone-danger-fg/g)).toHaveLength(2);
    expect(classTokens(danger)).not.toContain("text-accent");
  });

  it("draws a round-capped arc of the share from min, and closes the ring when full", () => {
    expect(gaugeShare(150, 300, 100)).toBe(0.25);
    expect(gaugeShare(-5, 100)).toBe(0);
    expect(gaugeShare(140, 100)).toBe(1);
    expect(gaugeShare(5, 0, 0)).toBe(0);
    const partial = gauge({ value: 150, min: 100, max: 300, figure: "150" });
    // A 40 px ring 5 px wide: radius 17.5, so a quarter is 27.49 px of arc.
    expect(partial).toMatch(/stroke-dasharray="27\.48/);
    expect(partial).toContain('stroke-linecap="round"');
    const full = gauge({ value: 100, figure: "100" });
    expect(full).not.toContain("stroke-linecap");
  });

  it("keeps the meter without a ring, and sets a lone figure large", () => {
    const bare = gauge({ ring: false });
    expect(bare).toContain('role="meter"');
    expect(bare).not.toContain("<svg");
    expect(classTokens(gauge({ lone: true }))).toContain("text-4xl");
    expect(classTokens(gauge())).not.toContain("text-4xl");
  });
});
