/**
 * The sparkline (src/components/charts/sparkline): a named image in its tone's ink, its two
 * scales — against zero with a flat baseline for too few values, and the observed range with a
 * floor and a lone point — and the fill and the newest-point marker on request.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Sparkline, sparklineDomain } from "../src/components/charts/sparkline/sparkline";
import { classTokens, renderStatic } from "../src/testing";

type Props = Parameters<typeof Sparkline>[0];
const spark = (props: Props) => renderStatic(createElement(Sparkline, props));

describe("Sparkline", () => {
  it("is an image named by the caller, in the muted ink or its tone's", () => {
    const html = spark({ values: [1, 3, 2], label: "Sessions, 30 days" });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Sessions, 30 days"');
    expect(html).toContain('data-tooltip="Sessions, 30 days"');
    expect(classTokens(html)).toEqual(expect.arrayContaining(["ui-chart", "text-fg-muted"]));
    const toned = spark({ values: [1, 3], label: "x", tone: "success" });
    expect(classTokens(toned)).toContain("text-tone-success-fg");
    expect(toned).not.toMatch(/gray-|emerald-|dark:/);
  });

  it("scales against zero, or to the observed range with a floor centred on the values", () => {
    expect(sparklineDomain([2, 4], "zero", 5)).toEqual({ low: 0, span: 4 });
    expect(sparklineDomain([0, 0], "zero", 5)).toEqual({ low: 0, span: 1 });
    expect(sparklineDomain([60, 90], "range", 5)).toEqual({ low: 60, span: 30 });
    expect(sparklineDomain([70, 71], "range", 5)).toEqual({ low: 68, span: 5 });
  });

  it("draws a flat baseline for too few values against zero, a lone point on a range", () => {
    const flat = spark({ values: [], label: "x", width: 100, height: 30 });
    expect(flat).toContain('d="M2,28 L98,28"');
    expect(flat).not.toContain('data-part="area"');
    const lone = spark({ values: [72], label: "x", scale: "range", marker: true });
    expect(lone).not.toContain('data-part="series"');
    expect(lone.match(/data-part="point"/g)).toHaveLength(1);
  });

  it("fills under the line and marks the newest point only when asked", () => {
    const plain = spark({ values: [1, 2, 3], label: "x" });
    expect(plain).not.toContain('data-part="area"');
    expect(plain).not.toContain('data-part="point"');
    const full = spark({ values: [1, 2, 3], label: "x", area: true, marker: true });
    expect(full).toContain('data-part="area"');
    expect(full.match(/data-part="point"/g)).toHaveLength(1);
  });
});
