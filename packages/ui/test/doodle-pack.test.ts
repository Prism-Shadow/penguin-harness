/**
 * Doodle's pen line (`src/themes/doodle/recipes.css`), whose drawings `scripts/draw-doodle-edges.mjs`
 * writes into the recipes' generated block.
 *
 * - Given a recipe that lays a drawing, then the drawing is one the pack declares, in light and in
 *   dark alike: a misspelt `var(--_stroke-…)` leaves a box with no line and nothing on screen to
 *   say why, and a drawing declared for light alone would lay light ink on dark paper.
 * - Given a person in forced colours, then no pen applies: every rule that lays a drawing or a
 *   clip sits under `forced-colors: none`, so the host's own border, fill and focus ring return in
 *   the system's colours.
 * - Given a long transcript, then nothing in the pack runs a filter: a slip's shadow is drawn into
 *   its own image, because a filter on a box cost as much raster as the whole transcript's lines.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES_DIR, parseCssRules, readPackSources } from "../src/testing";

const SOURCES = readPackSources(join(THEMES_DIR, "doodle"));
const RULES = SOURCES.flatMap((source) =>
  parseCssRules(source.css).map((rule) => ({ rule, file: source.file })),
);
const ROOT = ':root[data-theme="doodle"]';

/** The private properties each mode's root rule declares. */
function declared(selector: string): Set<string> {
  return new Set(
    RULES.filter(({ rule }) => rule.selector === selector).flatMap(({ rule }) =>
      rule.declarations.filter((d) => d.name.startsWith("--_")).map((d) => d.name),
    ),
  );
}

/** Every rule that reads a private property, with the names it reads. */
const READERS = RULES.flatMap(({ rule, file }) => {
  const names = rule.declarations.flatMap((d) =>
    [...d.value.matchAll(/var\(\s*(--_[\w-]+)/g)].map((m) => m[1]!),
  );
  return names.length === 0 ? [] : [{ rule, file, names }];
});

describe("Doodle's pen line", () => {
  it("reads only drawings the pack declares, in both modes", () => {
    const light = declared(ROOT);
    const dark = declared(`${ROOT}.dark`);
    expect(READERS.length).toBeGreaterThan(0);
    const missing = READERS.flatMap(({ rule, file, names }) =>
      names
        .filter((name) => !light.has(name) || (!name.startsWith("--_clip-") && !dark.has(name)))
        .map((name) => `${file}:${rule.line} ${rule.selector} reads ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it("lays no drawing or clip outside forced-colors: none", () => {
    const outside = RULES.filter(({ rule }) =>
      rule.declarations.some(
        (d) => /^(?:border-image(?:-source)?|clip-path)$/.test(d.name) && d.value !== "none",
      ),
    )
      .filter(({ rule }) => !rule.atRules.some((at) => /forced-colors:\s*none/.test(at)))
      .map(({ rule, file }) => `${file}:${rule.line} ${rule.selector}`);
    expect(outside).toEqual([]);
  });

  it("runs no filter anywhere", () => {
    const filters = RULES.flatMap(({ rule, file }) =>
      rule.declarations
        .filter((d) => /^(?:-webkit-)?filter$/.test(d.name) && d.value !== "none")
        .map((d) => `${file}:${d.line} ${rule.selector} { ${d.name}: ${d.value} }`),
    );
    expect(filters).toEqual([]);
  });
});
