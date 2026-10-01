/**
 * GlyphIcon: the stroke comes from the theme's token, the icon is hidden from assistive
 * technology, and `decor` writes the decorative-icon hook with its role — and only then. A
 * registry glyph is drawn in all three icon sets under the `ui-glyph` hook, the pixel drawing on
 * whole pixels; any other path is a line alone. Every key the sets are keyed by has a drawing in
 * each, and every pixel drawing is a 16x16 grid.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { GlyphIcon } from "../src/components/icons/glyph-icon/glyph-icon";
import { ICONS } from "../src/components/icons/icons";
import {
  ICON_TINTS,
  OCTICONS,
  OCTICONS_FILLED,
  PIXEL_ICONS,
  PIXEL_ICONS_FILLED,
} from "../src/components/icons/sets";
import type { GlyphKey, MarkName } from "../src/components/icons/sets";
import { ICON_SIZE } from "../src/icon-scale";
import { classTokens, renderStatic } from "../src/testing";

describe("GlyphIcon", () => {
  it("strokes the path at the theme's weight, sized by the inline rung by default", () => {
    const html = renderStatic(createElement(GlyphIcon, { d: ICONS.gear }));
    expect(html).toContain("stroke-width:var(--ui-icon-stroke, 1.7)");
    expect(html).not.toMatch(/stroke-width="/);
    expect(html).toContain(`width="${ICON_SIZE.inlineGlyph}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`<path d="${ICONS.gear}" fill="none">`);
  });

  it("fills the line drawing for a mark whose on state is solid", () => {
    expect(renderStatic(createElement(GlyphIcon, { d: ICONS.pin, filled: true }))).toContain(
      `<path d="${ICONS.pin}" fill="currentColor">`,
    );
  });

  it("carries the decorative-icon hook, its role and its tint only when the call site says so", () => {
    const plain = renderStatic(createElement(GlyphIcon, { d: ICONS.folder }));
    expect(classTokens(plain)).not.toContain("ui-icon-decor");
    expect(plain).not.toContain("data-role");
    expect(plain).not.toContain("data-tint");

    const nav = renderStatic(createElement(GlyphIcon, { d: ICONS.folder, decor: "nav" }));
    expect(classTokens(nav)).toContain("ui-icon-decor");
    expect(nav).toContain('data-role="nav"');
    expect(nav).toContain(`data-tint="${ICON_TINTS.folder}"`);
  });

  it("draws a registry glyph in every set, and any other path as a line alone", () => {
    const glyph = renderStatic(createElement(GlyphIcon, { d: ICONS.trash }));
    expect(classTokens(glyph)).toContain("ui-glyph");
    expect([...glyph.matchAll(/data-set="(\w+)"/g)].map((m) => m[1])).toEqual([
      "line",
      "octicons",
      "pixel",
    ]);

    const own = renderStatic(createElement(GlyphIcon, { d: "M3 7h18", decor: "group" }));
    expect(classTokens(own)).not.toContain("ui-glyph");
    expect(own).not.toContain("data-set");
    expect(own).not.toContain("data-tint");
    expect(own).toContain('<path d="M3 7h18" fill="none"></path></svg>');
  });

  it("lays the pixel drawing out one cell to a pixel from 13px up, and fills a smaller box", () => {
    const pixelBox = (size: number) =>
      /data-set="pixel" x="([^"]+)" y="[^"]+" width="([^"]+)"/
        .exec(renderStatic(createElement(GlyphIcon, { d: ICONS.gear, size })))
        ?.slice(1)
        .map(Number);
    // In the box's 24 user units: 16 px wide, offset by whole pixels.
    expect(pixelBox(16)).toEqual([0, 24]);
    expect(pixelBox(20)).toEqual([2.4, 19.2]);
    expect(pixelBox(14)).toEqual([round4((-1 * 24) / 14), round4((16 * 24) / 14)]);
    expect(pixelBox(12)).toEqual([0, 24]);
  });
});

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/** SVG path data: a moveto, then only path commands, numbers and separators. */
const PATH_DATA = /^[Mm][\d\s.,eE+\-MmZzLlHhVvCcSsQqTtAa]*$/;

/** Every mark drawn as a component, spelled as a record so a new `MarkName` fails here. */
const MARKS: Record<MarkName, true> = {
  caret: true,
  check: true,
  plus: true,
  download: true,
  upload: true,
  close: true,
  chevron: true,
};

describe("icon sets", () => {
  const keys = [...Object.keys(ICONS), ...Object.keys(MARKS)] as GlyphKey[];

  it("draw every glyph and every mark: an Octicon path and a 16x16 pixel grid each", () => {
    for (const key of keys) {
      expect(OCTICONS[key], key).toMatch(PATH_DATA);
      expect(OCTICONS_FILLED[key] ?? OCTICONS[key], key).toMatch(PATH_DATA);
      expect(PIXEL_ICONS[key], key).toBeDefined();
      for (const grid of [PIXEL_ICONS[key], PIXEL_ICONS_FILLED[key]]) {
        if (grid === undefined) continue;
        expect(grid.length, key).toBe(16);
        for (const row of grid) expect(row, key).toMatch(/^[#.]{16}$/);
      }
    }
  });
});

describe("ICONS", () => {
  it("holds 24x24 path data under names that describe the drawing", () => {
    for (const [name, d] of Object.entries(ICONS)) {
      expect(d, name).toMatch(PATH_DATA);
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
