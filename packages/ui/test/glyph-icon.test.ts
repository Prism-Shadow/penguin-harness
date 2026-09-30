/**
 * GlyphIcon: the stroke comes from the theme's token, the icon is hidden from assistive
 * technology, and `decor` writes the decorative-icon hook with its role — and only then.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { GlyphIcon } from "../src/components/icons/glyph-icon/glyph-icon";
import { ICONS } from "../src/components/icons/icons";
import { ICON_SIZE } from "../src/icon-scale";
import { classTokens, renderStatic } from "../src/testing";

describe("GlyphIcon", () => {
  it("strokes the path at the theme's weight, sized by the inline rung by default", () => {
    const html = renderStatic(createElement(GlyphIcon, { d: ICONS.gear }));
    expect(html).toContain("stroke-width:var(--ui-icon-stroke, 1.7)");
    expect(html).not.toMatch(/stroke-width="/);
    expect(html).toContain(`width="${ICON_SIZE.inlineGlyph}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`d="${ICONS.gear}"`);
    expect(html).toContain('fill="none"');
  });

  it("fills the path for a mark whose on state is solid", () => {
    expect(renderStatic(createElement(GlyphIcon, { d: ICONS.pin, filled: true }))).toContain(
      'fill="currentColor"',
    );
  });

  it("carries the decorative-icon hook and its role only when the call site says so", () => {
    const plain = renderStatic(createElement(GlyphIcon, { d: ICONS.folder }));
    expect(classTokens(plain)).not.toContain("ui-icon-decor");
    expect(plain).not.toContain("data-role");

    const nav = renderStatic(createElement(GlyphIcon, { d: ICONS.folder, decor: "nav" }));
    expect(classTokens(nav)).toContain("ui-icon-decor");
    expect(nav).toContain('data-role="nav"');
  });
});

describe("ICONS", () => {
  it("holds 24x24 path data under names that describe the drawing", () => {
    for (const [name, d] of Object.entries(ICONS)) {
      expect(d, name).toMatch(/^[Mm][\d\s.,eE+\-MmZzLlHhVvCcSsQqTtAa]*$/);
      expect(name, "a key names the drawing in camelCase").toMatch(/^[a-z][A-Za-z]*$/);
    }
  });

  it("draws each glyph once: no two names share a path", () => {
    const byPath = new Map<string, string[]>();
    for (const [name, d] of Object.entries(ICONS)) {
      byPath.set(d, [...(byPath.get(d) ?? []), name]);
    }
    expect([...byPath.values()].filter((names) => names.length > 1)).toEqual([]);
  });

  it("builds the open and the struck-through eye from one outline", () => {
    const outline = ICONS.eyeOff.replace("M3 3l18 18", "");
    expect(ICONS.eye.startsWith(outline)).toBe(true);
  });
});
