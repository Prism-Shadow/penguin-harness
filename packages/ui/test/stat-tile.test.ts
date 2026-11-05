/**
 * StatTile (src/components/data/stat-tile/stat-tile.tsx): one KPI as a bordered tile, its value in
 * tabular figures, a tone inking the glyph and the value together.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { StatTile } from "../src/components/data/stat-tile/stat-tile";
import { classTokens, renderStatic } from "../src/testing";

describe("StatTile", () => {
  it("is a plain bordered tile: label, value in tabular figures, then the detail", () => {
    const html = renderStatic(
      createElement(StatTile, { icon: "M4 4h16", label: "Spend", value: "$12", detail: "of $40" }),
    );
    expect(html).not.toContain("<button");
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["border-line", "bg-surface", "tabular-nums"]),
    );
    expect(html.indexOf("Spend")).toBeLessThan(html.indexOf("$12"));
    expect(html.indexOf("$12")).toBeLessThan(html.indexOf("of $40"));
  });

  it("inks the glyph and the value in the tone, and nothing without one", () => {
    const toned = renderStatic(
      createElement(StatTile, { icon: "M4 4h16", label: "Alerts", value: 2, tone: "danger" }),
    );
    expect(toned.match(/text-tone-danger-fg/g)).toHaveLength(2);
    const plain = renderStatic(createElement(StatTile, { label: "Employees", value: 7 }));
    expect(plain).not.toContain("text-tone-");
    expect(plain).not.toContain("<svg");
  });
});
