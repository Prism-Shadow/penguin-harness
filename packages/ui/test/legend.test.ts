/**
 * The legend (src/components/charts/legend): a list of the caller's labels, each with the swatch
 * its marks are painted in, or a mark of its own; inline items fade while another is singled
 * out, list rows wash and ring, a selectable item is a toggle button, and an item that explains
 * a shape stays still.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Legend } from "../src/components/charts/legend/legend";
import type { LegendItem } from "../src/components/charts/legend/legend";
import { classTokens, renderStatic } from "../src/testing";

type Props = Parameters<typeof Legend>[0];
const legend = (props: Props) => renderStatic(createElement(Legend, props));

const ITEMS: LegendItem[] = [
  { key: "read", label: "Cache read", paint: { role: "cacheRead" }, shape: "chip" },
  { key: "out", label: "Output", paint: { role: "output" }, shape: "chip" },
  {
    key: "rate",
    label: "Hit rate",
    paint: { ink: "text-fg-subtle", swatch: "bg-fg-subtle" },
    shape: "dash",
    interactive: false,
  },
];

/** The `<li>` markup of each item, in order. */
const itemsOf = (html: string) => html.match(/<li[\s\S]*?<\/li>/g) ?? [];

describe("Legend", () => {
  it("lists the caller's labels, named when asked, each with its swatch", () => {
    const html = legend({ items: ITEMS, label: "Token kinds" });
    expect(html).toMatch(/^<ul aria-label="Token kinds"/);
    expect(itemsOf(html)).toHaveLength(3);
    for (const label of ["Cache read", "Output", "Hit rate"]) expect(html).toContain(label);
    expect(html).toContain("var(--ui-chart-cache-read)");
    expect(html).toContain("bg-fg-subtle");
    expect(html).not.toMatch(/gray-|dark:/);
  });

  it("fades the other items while one is singled out, never the one that explains a shape", () => {
    const [read, out, rate] = itemsOf(legend({ items: ITEMS, active: "read" }));
    expect(read).not.toContain("opacity-30");
    expect(out).toContain("opacity-30");
    expect(rate).not.toContain("opacity-30");
    expect(itemsOf(legend({ items: ITEMS }))[1]).not.toContain("opacity-30");
  });

  it("makes each item a toggle button with onSelect, pressed while pinned", () => {
    const html = legend({ items: ITEMS, pinned: "out", onSelect: () => {}, onHover: () => {} });
    const [read, out, rate] = itemsOf(html);
    expect(read).toContain('<button type="button" aria-pressed="false"');
    expect(out).toContain('aria-pressed="true"');
    expect(rate).not.toContain("<button");
  });

  it("lays a list out row by row, with the figures after the label, a wash and a pin ring", () => {
    const rows: LegendItem[] = [
      { key: "a", label: "read_file", value: createElement("span", null, "~1.2k") },
      { key: "b", label: "grep", title: "grep in src/", value: createElement("span", null, "~40") },
    ];
    const html = legend({ items: rows, layout: "list", mono: true, active: "a", pinned: "b" });
    const [a, b] = itemsOf(html);
    expect(a).toContain("<span>~1.2k</span>");
    expect(classTokens(a!)).toEqual(expect.arrayContaining(["bg-tone-neutral-bg", "font-mono"]));
    expect(classTokens(b!)).toContain("inset-ring-fg-subtle");
    expect(b).toContain('data-tooltip="grep in src/"');
    expect(b).toContain('data-tooltip-content="code"');
    // No paint and no mark: no swatch.
    expect(a).not.toContain("inline-block");
  });

  it("draws an item's own mark in the swatch's place", () => {
    const html = legend({
      items: [{ key: "run", label: "Running", mark: createElement("i", { id: "dot" }) }],
    });
    expect(html).toContain('<i id="dot"></i>');
    expect(html).not.toContain("inline-block");
  });
});
