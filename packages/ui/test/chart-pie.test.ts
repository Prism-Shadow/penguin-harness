/**
 * The pie chart (src/components/charts/pie-chart): slices of one series as ring arcs, and the list
 * legend that reads them out.
 *
 * - Given slices, each takes its share of the circle, clockwise from twelve o'clock in order,
 *   with a hairline between neighbours; a lone slice closes the circle with no gap.
 * - Given a slice of nothing, no arc is drawn for it, but its legend row stays.
 * - Given `donut`, the ring leaves the middle of the radius open; without it the arc covers the
 *   disc from the centre out.
 * - The legend lists each slice's amount in the caller's format and its share, a sliver as "<1%";
 *   `legend="none"` leaves it out. The circle is an image named by the caller.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PieChart } from "../src/components/charts/pie-chart/pie-chart";
import type { PieChartProps } from "../src/components/charts/pie-chart/pie-chart";
import { pieArcs, pieRing, shareText } from "../src/components/charts/pie-chart/pie-geom";
import { DEFAULT_CHART_STYLE } from "../src/components/charts/chart-style";
import { renderStatic } from "../src/testing";

const gb = (v: number) => `${v.toLocaleString("en-US")} GB`;
const pie = (props: Partial<PieChartProps> & Pick<PieChartProps, "slices">) =>
  renderStatic(createElement(PieChart, { fmtValue: gb, label: "Storage", ...props }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("PieChart", () => {
  it("gives each slice its share of the circle from twelve o'clock, a hairline apart", () => {
    const c = 2 * Math.PI * 40;
    const [first, second] = pieArcs([{ value: 1 }, { value: 3 }], c);
    expect(first!.offset).toBeCloseTo(0);
    expect(first!.length).toBeCloseTo(c / 4 - 1.5);
    expect(second!.offset).toBeCloseTo(-c / 4);
    expect(second!.length).toBeCloseTo((3 * c) / 4 - 1.5);
    const [whole] = pieArcs([{ value: 5 }], c);
    expect(whole!.length).toBeCloseTo(c);

    const html = pie({
      slices: [
        { label: "Images", value: 1 },
        { label: "Video", value: 3 },
      ],
    });
    expect(count(html, 'data-part="series"')).toBe(2);
    expect(html).toContain('transform="rotate(-90 80 80)"');
    expect(html).toContain(`color:${DEFAULT_CHART_STYLE.series[0]}`);
    expect(html).toContain(`color:${DEFAULT_CHART_STYLE.series[1]}`);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Storage"');
  });

  it("draws nothing for a slice of nothing, and keeps its legend row", () => {
    const html = pie({
      slices: [
        { label: "Images", value: 2 },
        { label: "Video", value: 0 },
        { label: "Other", value: 2 },
      ],
    });
    expect(count(html, 'data-part="series"')).toBe(2);
    expect(count(html, "<li")).toBe(3);
    expect(html).toMatch(/>Video<[\s\S]*>0 GB<[\s\S]*>0%</);
  });

  it("leaves the middle open as a donut, and covers the disc from the centre without", () => {
    expect(pieRing(160, false)).toMatchObject({ c: 80, r: 40, width: 80 });
    expect(pieRing(160, true)).toMatchObject({ c: 80, r: 64, width: 32 });
    const donut = pie({ slices: [{ label: "Images", value: 1 }], donut: true });
    expect(donut).toContain('r="64"');
    expect(donut).toContain('stroke-width="32"');
  });

  it("lists each amount and share, a sliver as under one percent, unless the legend is off", () => {
    const html = pie({
      slices: [
        { label: "Images", value: 1240 },
        { label: "Other", value: 4 },
      ],
    });
    expect(html).toMatch(/>Images<[\s\S]*>1,240 GB<[\s\S]*>100%</);
    expect(html).toMatch(/>Other<[\s\S]*>4 GB<[\s\S]*>&lt;1%</);
    expect(shareText(0.384)).toBe("38%");
    expect(pie({ slices: [{ label: "Images", value: 1 }], legend: "none" })).not.toContain("<ul");
  });
});
