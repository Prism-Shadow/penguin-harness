/**
 * StatChip (src/components/data/stat-chip/stat-chip.tsx): a glyph with a value in tabular figures,
 * named by its label, with a compact value and a wide-only form for a row that must fit a phone.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { StatChip } from "../src/components/data/stat-chip/stat-chip";
import { classTokens, renderStatic } from "../src/testing";

describe("StatChip", () => {
  it("is named by its label, as its tooltip and accessible name, in tabular figures", () => {
    const html = renderStatic(
      createElement(StatChip, { glyph: "M4 4h16", value: "1.2k", label: "Input" }),
    );
    expect(html).toContain('data-tooltip="Input" aria-label="Input"');
    expect(classTokens(html)).toEqual(expect.arrayContaining(["flex", "tabular-nums"]));
    expect(html).toContain("1.2k");
  });

  it("swaps in the compact value below sm, and drops a wide-only chip there", () => {
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
    expect(html).toContain('<span class="hidden sm:inline">$0.0123</span>');
    expect(classTokens(html)).toEqual(expect.arrayContaining(["hidden", "sm:flex"]));
  });
});
