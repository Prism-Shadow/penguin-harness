/**
 * StatChip (src/components/data/stat-chip/stat-chip.tsx): a glyph with a value in tabular figures,
 * named by its label, with a compact value and a wide-only form for a row that must fit a phone.
 * An inline chip sits in a line that truncates as one, and leaves the hover hint to that line.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { StatChip } from "../src/components/data/stat-chip/stat-chip";
import { renderStatic, markupStructure } from "../src/testing";

describe("StatChip", () => {
  it("is named by its label, as its tooltip and accessible name", () => {
    const html = renderStatic(
      createElement(StatChip, { glyph: "M4 4h16", value: "1.2k", label: "Input" }),
    );
    expect(html).toContain('data-tooltip="Input" aria-label="Input"');
    expect(html).toContain("1.2k");
  });

  it("carries both the compact and the full value", () => {
    const html = renderStatic(
      createElement(StatChip, {
        glyph: "M4 4h16",
        value: "$0.0123",
        compactValue: "$0.01",
        label: "Cost",
        wideOnly: true,
      }),
    );
    expect(html).toContain('<span class="sm:hidden">$0.01</span>');
    expect(markupStructure(html)).toContain("<span>$0.0123</span>");
  });

  it("an inline chip is an inline box named only for assistive technology: the line around it owns the hint", () => {
    const html = renderStatic(
      createElement(StatChip, { glyph: "M4 4h16", value: "71%", label: "Hit rate", inline: true }),
    );
    expect(html).not.toContain("data-tooltip");
    expect(html).toContain('aria-label="Hit rate"');
  });
});
