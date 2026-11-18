import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import { RequestsChart } from "../src/features/usage/usage-charts";

vi.mock("@prismshadow/penguin-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prismshadow/penguin-ui")>()),
  useChartWidth: () => [{ current: null }, 480],
}));

function draw(completed: number[], denominator: number[], breaks: number[] = []) {
  const series: UsageSeriesPoint[] = completed.map((successes, i) => ({
    bucket: `2026-11-${10 + i}`,
    requests: 2,
    completed: successes,
    denominator: denominator[i]!,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    total: 0,
    cost: null,
  }));
  return renderToStaticMarkup(
    createElement(RequestsChart, {
      label: "Model requests and success rates",
      series,
      entities: [
        { label: "Model", requests: series.map((row) => row.requests), completed, denominator },
      ],
      granularity: "day",
      breaks,
    }),
  );
}

describe("request success-rate marks", () => {
  it.each([
    [0, 178],
    [1, 94],
    [2, 10],
  ])("places %i successes out of two at the matching right-axis height", (completed, expectedY) => {
    const doc = draw([completed!], [2]);
    const point = doc.match(/<rect[^>]+data-part="point"[^>]+>/)?.[0];
    const attr = (name: string) => Number(point?.match(new RegExp(` ${name}="([^"]+)"`))?.[1]);
    expect(attr("y") + attr("height") / 2).toBe(expectedY);
    expect(attr("y")).toBeGreaterThanOrEqual(0);
    expect(attr("y") + attr("height")).toBeLessThan(200);
    expect(doc).not.toContain('data-part="series"');
    expect(doc).toContain('data-part="bar"');
  });

  it("leaves both unavailable and compressed intervals open and connects adjacent observations", () => {
    const doc = draw([2, 0, 0, 1, 2], [2, 0, 2, 2, 2], [2]);
    expect(doc.match(/data-part="point"/g)).toHaveLength(2);
    expect(doc.match(/data-part="series"/g)).toHaveLength(1);
    expect(draw([0], [0])).not.toMatch(/data-part="(?:series|point)"/);
  });
});
