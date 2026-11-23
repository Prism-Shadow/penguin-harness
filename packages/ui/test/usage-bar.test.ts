/**
 * The usage bar (src/components/charts/usage-bar): one total split into its parts as a stack.
 *
 * - Given parts of different sizes, each segment's width follows its value, end to end in order.
 * - Given a part of zero, nothing is drawn for it and the legend does not list it.
 * - Given a sliver beside large parts, the sliver is held at the size's smallest share and the
 *   parts still fill the track exactly.
 * - Given a list's scale, a row's bar fills only its share of the track.
 * - Given no part with a value, only the empty track is drawn, and no legend.
 * - Given no legend, the bar is an image named by its label and every part with its size; given a
 *   legend, the bar is hidden and the named list carries the parts and their sizes.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  USAGE_MIN_SHARE,
  UsageBar,
  usageBarPlaces,
} from "../src/components/charts/usage-bar/usage-bar";
import type { UsageSegment } from "../src/components/charts/usage-bar/usage-bar";
import { renderStatic } from "../src/testing";

type Props = Parameters<typeof UsageBar>[0];
const bar = (props: Props) => renderStatic(createElement(UsageBar, props));

const GB = 1024 ** 3;
const part = (key: string, value: number, slot: number): UsageSegment => ({
  key,
  label: key,
  value,
  paint: { series: slot },
  display: `${(value / GB).toFixed(1)} GB`,
});

/** The widths the rendered segments take, in order, as percentages. */
const widthsOf = (html: string) =>
  [...html.matchAll(/data-part="bar"[^>]*style="[^"]*width:([\d.]+)%/g)].map((m) => Number(m[1]));

const sum = (values: number[]) => values.reduce((n, v) => n + v, 0);

describe("UsageBar", () => {
  it("gives each part a width that follows its value, end to end in order", () => {
    const places = usageBarPlaces([part("a", 3 * GB, 0), part("b", 1 * GB, 1)]);
    expect(places).toEqual([
      { key: "a", left: 0, width: 75 },
      { key: "b", left: 75, width: 25 },
    ]);
    const html = bar({ segments: [part("a", 3 * GB, 0), part("b", 1 * GB, 1)], label: "Used" });
    expect(widthsOf(html)).toEqual([75, 25]);
  });

  it("draws nothing for a part of zero and leaves it out of the legend", () => {
    const segments = [part("traces", 2 * GB, 0), part("logs", 0, 1), part("other", 2 * GB, 2)];
    const html = bar({ segments, label: "Used", legend: true });
    expect(widthsOf(html)).toEqual([50, 50]);
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).not.toContain(">logs<");
  });

  it("holds a sliver at the smallest share and still fills the track exactly", () => {
    const places = usageBarPlaces(
      [part("big", 1000 * GB, 0), part("tiny", 1, 1), part("mid", 500 * GB, 2)],
      USAGE_MIN_SHARE.md,
    );
    expect(places.find((p) => p.key === "tiny")!.width).toBeCloseTo(USAGE_MIN_SHARE.md);
    expect(sum(places.map((p) => p.width))).toBeCloseTo(100);
    const big = places.find((p) => p.key === "big")!.width;
    const mid = places.find((p) => p.key === "mid")!.width;
    expect(big / mid).toBeCloseTo(2);
    // Each part starts where the one before it ends.
    for (let i = 1; i < places.length; i++) {
      expect(places[i]!.left).toBeCloseTo(places[i - 1]!.left + places[i - 1]!.width);
    }
  });

  it("fills only a row's share of the track when a list sets the scale", () => {
    const html = bar({
      segments: [part("a", 1 * GB, 0), part("b", 1 * GB, 1)],
      max: 4 * GB,
      size: "sm",
      label: "Project",
    });
    expect(sum(widthsOf(html))).toBeCloseTo(50);
  });

  it("draws only the empty track, and no legend, when no part has a value", () => {
    const html = bar({ segments: [part("a", 0, 0)], label: "Used", legend: true });
    expect(html).toContain('data-part="grid"');
    expect(html).not.toContain('data-part="bar"');
    expect(html).not.toContain("<ul");
  });

  it("names the bar by its parts without a legend, and lets the legend speak with one", () => {
    const segments = [part("traces", 3 * GB, 0), part("caches", 1 * GB, 1)];
    const alone = bar({ segments, label: "Used" });
    expect(alone).toMatch(/role="img" aria-label="Used · traces 3\.0 GB · caches 1\.0 GB"/);
    const listed = bar({ segments, label: "Used", legend: true });
    expect(listed).toContain('aria-hidden="true"');
    expect(listed).not.toContain('role="img"');
    expect(listed).toContain('<ul aria-label="Used"');
    expect(listed).toContain("3.0 GB");
    expect(listed).toContain("1.0 GB");
  });
});
