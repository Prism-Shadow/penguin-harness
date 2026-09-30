/**
 * The plot frame (src/components/charts/chart-frame): the `ui-chart` root in the muted ink, its
 * grid and axis labels as named parts with the caller's formatting, the caller's marks between
 * them, and no bubble until a point is hovered. The frame's geometry is chart-geom.test.ts.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ChartFrame } from "../src/components/charts/chart-frame/chart-frame";
import { makeGeom } from "../src/components/charts/chart-frame/chart-geom";
import { classTokens, renderStatic } from "../src/testing";

type Props = Parameters<typeof ChartFrame>[0];

const frame = (props: Partial<Props> = {}) =>
  renderStatic(
    createElement(ChartFrame, {
      geom: makeGeom(3, 100, 640),
      fmtY: (v: number) => `$${v}`,
      dates: ["2026-09-01", "2026-09-02", "2026-09-03"],
      hover: null,
      onHover: () => {},
      ...props,
    }),
  );

describe("ChartFrame", () => {
  it("draws an image root carrying the chart hook, in the muted ink", () => {
    const html = frame();
    expect(html).toContain('role="img"');
    expect(classTokens(html)).toEqual(expect.arrayContaining(["ui-chart", "text-fg-muted"]));
    expect(html).not.toMatch(/gray-|dark:/);
  });

  it("names its grid and axis parts, and prints the caller's tick and date formats", () => {
    const html = frame({ fmtX: (d: string) => d.slice(8) });
    expect(html.match(/data-part="grid"/g)).toHaveLength(5);
    expect(html).toContain(">$100<");
    expect(html).toContain(">$0<");
    expect(html).toContain(">01<");
    expect(html).toContain(">03<");
  });

  it("draws the caller's marks, and a bubble only while a point is hovered", () => {
    const mark = createElement("g", { id: "marks" });
    expect(frame({ children: mark })).toContain('<g id="marks"></g>');
    const bubble = (i: number) => `day ${i}`;
    expect(frame({ bubble })).not.toContain("day ");
    const hovered = frame({ bubble, hover: 1 });
    expect(hovered).toContain("day 1");
    expect(classTokens(hovered)).toEqual(expect.arrayContaining(["border-line", "bg-overlay"]));
  });
});
