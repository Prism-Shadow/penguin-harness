// @vitest-environment jsdom
/**
 * The Cost Center's rate lines on a live page (features/usage/usage-charts.tsx, rate-line.tsx).
 * jsdom lays nothing out, so the suite gives every element the width a card would have; the
 * charts draw only once they have measured it.
 *
 * - Given a success rate measured in one bucket only, the chart draws a point, and it reads
 *   against the right-hand axis at its value: 0%, 50% and 100%.
 * - Given idle buckets and a skipped interval, a success-rate line joins only neighbouring rates
 *   and leaves the rest open; an entity whose every request was aborted draws its bars and no
 *   line at all.
 * - Given a bucket with no cache traffic, the cache hit-rate curve breaks there instead of
 *   crossing it at the top of the axis.
 * - Given the keyboard, the Token chart opens a whole bucket's bubble, which prints a dash for a
 *   bucket with nothing to rate, and Esc closes it.
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import {
  RequestsChart,
  TokenBarChart,
} from "@prismshadow/penguin-library-observability/web/usage/usage-charts";
import { S } from "../src/lib/strings";
import { mount, run, unmountAll } from "./helpers/dom";

const CARD_WIDTH = 480;

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: CARD_WIDTH,
    bottom: 240,
    width: CARD_WIDTH,
    height: 240,
    toJSON: () => ({}),
  });
});

afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

function point(i: number, over: Partial<UsageSeriesPoint> = {}): UsageSeriesPoint {
  return {
    bucket: `2026-11-${String(10 + i).padStart(2, "0")}`,
    requests: 2,
    completed: 2,
    denominator: 2,
    cacheRead: 30,
    cacheWrite: 10,
    output: 20,
    total: 60,
    cost: null,
    ...over,
  };
}

/** One model's requests chart over these per-bucket success counts and denominators. */
async function requests(completed: number[], denominator: number[], breaks: number[] = []) {
  const series = completed.map((_, i) => point(i));
  const { container } = await mount(
    createElement(RequestsChart, {
      label: "Requests by model",
      series,
      entities: [
        { label: "model-a", requests: series.map((p) => p.requests), completed, denominator },
      ],
      granularity: "day",
      breaks,
    }),
  );
  return container;
}

const marks = (root: Element, part: "point" | "series") =>
  [...root.querySelectorAll(`[data-part="${part}"]`)] as SVGElement[];

const centreY = (el: Element) =>
  Number(el.getAttribute("y")) + Number(el.getAttribute("height")) / 2;

/** The right-hand axis tick whose label sits closest to `y`. */
function nearestRightTick(root: Element, y: number): string | undefined {
  const ticks = [...root.querySelectorAll('[data-part="axis"]')].filter((t) =>
    t.textContent?.endsWith("%"),
  );
  return ticks
    .map((t) => ({ label: t.textContent!, d: Math.abs(Number(t.getAttribute("y")) - y) }))
    .sort((a, b) => a.d - b.d)[0]?.label;
}

describe("the success-rate lines", () => {
  it.each([
    [0, "0%"],
    [1, "50%"],
    [2, "100%"],
  ])("draws %i successes out of two in a lone bucket as a point at %s", async (ok, tick) => {
    const chart = await requests([ok], [2]);
    const [lone, ...more] = marks(chart, "point");
    expect(more).toHaveLength(0);
    expect(marks(chart, "series")).toHaveLength(0);
    expect(nearestRightTick(chart, centreY(lone!))).toBe(tick);
  });

  it("joins only neighbouring rates, leaving idle buckets and skipped intervals open", async () => {
    // Rated, nothing to rate, rated | skipped | rated, rated.
    const chart = await requests([2, 0, 0, 1, 2], [2, 0, 2, 2, 2], [2]);
    expect(marks(chart, "point")).toHaveLength(2);
    expect(marks(chart, "series")).toHaveLength(1);
  });

  it("draws no line for an entity whose every request was aborted", async () => {
    const chart = await requests([0, 0], [0, 0]);
    expect(chart.querySelector('[data-part="bar"]')).not.toBeNull();
    expect(marks(chart, "point")).toHaveLength(0);
    expect(marks(chart, "series")).toHaveLength(0);
  });
});

describe("the cache hit-rate curve", () => {
  const series = [
    point(0),
    point(1),
    point(2, { cacheRead: 0, cacheWrite: 0, total: 20 }),
    point(3),
    point(4),
  ];

  async function tokens() {
    const { container } = await mount(
      createElement(TokenBarChart, { label: "Token trend", series, granularity: "day" }),
    );
    return container;
  }

  it("breaks at a bucket with no cache traffic instead of crossing it at the top", async () => {
    const chart = await tokens();
    expect(marks(chart, "series")).toHaveLength(2);
    expect(marks(chart, "point")).toHaveLength(0);
  });

  it("opens a bucket's bubble from the keyboard, with a dash where there is no hit rate", async () => {
    const chart = await tokens();
    const svg = chart.querySelector("svg")!;
    const press = (key: string) =>
      run(() => svg.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
    const bubble = () => chart.querySelector('[role="tooltip"]');

    await press("ArrowRight");
    await press("ArrowRight");
    await press("ArrowRight");
    expect(bubble()?.textContent).toContain(series[2]!.bucket);
    expect(bubble()?.textContent).toContain(`${S.usage.legendHitRate}—`);

    await press("Escape");
    expect(bubble()).toBeNull();
  });
});
