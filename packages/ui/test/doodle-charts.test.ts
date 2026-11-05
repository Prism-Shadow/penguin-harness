/**
 * Doodle's charts (`themes/cartoon/charts.css`), against the patterns and the filter `ChartDefs`
 * draws in every document a chart is drawn in.
 *
 * - Every pattern and filter the theme paints a chart with is one ChartDefs defines: a misspelt
 *   `url(#…)` would leave a bar flat or a line straight, with nothing on screen to say why.
 * - Every hatch ChartDefs draws fills the bars of its own series, so no palette slot or Token kind
 *   is left flat beside hatched ones, and a stacked Token bar keeps its three densities.
 * - The filter roughens strokes only: a rule that filters selects a path, a polyline, a line or a
 *   group of lines, never an element that can hold text.
 * - The tiles an HTML mark (a swatch, a timeline bar) is hatched with are the ones
 *   `scripts/draw-doodle-hatches.mjs` draws from the slip's colour of each mode: an image cannot
 *   read the token, so the script reads it, and a slip that changed leaves the tiles stale.
 * - Every tile a recipe reads is one the script draws.
 */
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ChartDefs } from "../src/components/charts/chart-defs";
import { parseCssRules, readThemeSources, renderStatic, selectorList } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

const SCRIPT = join(SRC_DIR, "..", "scripts", "draw-doodle-hatches.mjs");
const RULES = readThemeSources(join(SRC_DIR, "themes"), "cartoon").flatMap((source) =>
  parseCssRules(source.css).map((rule) => ({ rule, file: source.file })),
);
const DEFS = renderStatic(createElement(ChartDefs));
const DEFINED = new Set(
  [...DEFS.matchAll(/<(?:pattern|filter) id="([\w-]+)"/g)].map((match) => match[1]!),
);
const HATCHES = [...DEFINED].filter((id) => id.startsWith("ui-hatch-"));

/** A selector's compounds, split on the spaces between them (not those inside `()` or `[]`). */
function compounds(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of selector.trim()) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current !== "") parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current !== "") parts.push(current);
  return parts;
}

/** The element types a stroke is drawn as; a compound must open with one of them, or `:is()` of them. */
const STROKE = "(?:path|polyline|line|g)";
const STROKE_COMPOUND = new RegExp(
  `^(?::is\\(${STROKE}(?:,\\s*${STROKE})*\\)|${STROKE})(?=\\[|:|$)`,
);

describe("Doodle's charts", () => {
  it("paint with nothing but the patterns and the filter ChartDefs defines", () => {
    const unknown = RULES.flatMap(({ rule, file }) =>
      rule.declarations.flatMap((declaration) =>
        [...declaration.value.matchAll(/url\(\s*#([\w-]+)\s*\)/g)]
          .map((match) => match[1]!)
          .filter((id) => !DEFINED.has(id))
          .map((id) => `${file}:${declaration.line} ${rule.selector} url(#${id})`),
      ),
    );
    expect(HATCHES.length).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });

  it("fill each series' bars with that series' own hatch, a Token kind's included", () => {
    const unfilled = HATCHES.filter((id) => {
      const series = id.slice("ui-hatch-".length);
      return !RULES.some(
        ({ rule }) =>
          selectorList(rule.selector).some((selector) =>
            selector.includes(`[data-part="bar"][data-series="${series}"]`),
          ) &&
          rule.declarations.some(
            (declaration) =>
              declaration.name === "fill" && declaration.value.startsWith(`url(#${id})`),
          ),
      );
    });
    expect(unfilled).toEqual([]);
  });

  it("roughen strokes only, never an element that can hold text", () => {
    const astray = RULES.flatMap(({ rule, file }) =>
      rule.declarations.some(
        (declaration) =>
          /^(?:-webkit-)?filter$/.test(declaration.name) && declaration.value !== "none",
      )
        ? selectorList(rule.selector)
            .filter((selector) => !STROKE_COMPOUND.test(compounds(selector).at(-1) ?? ""))
            .map((selector) => `${file}:${rule.line} ${selector.trim()}`)
        : [],
    );
    expect(astray).toEqual([]);
  });

  it("hatch an HTML mark with the tiles the script draws from the slip of each mode", () => {
    expect(() =>
      execFileSync(process.execPath, [SCRIPT, "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("read only tiles the script draws", () => {
    const drawn = new Set(
      RULES.flatMap(({ rule }) =>
        rule.declarations
          .filter((declaration) => declaration.name.startsWith("--_hatch-"))
          .map((declaration) => declaration.name),
      ),
    );
    const unknown = RULES.flatMap(({ rule, file }) =>
      rule.declarations.flatMap((declaration) =>
        [...declaration.value.matchAll(/var\(\s*(--_hatch-[\w-]+)/g)]
          .map((match) => match[1]!)
          .filter((name) => !drawn.has(name))
          .map((name) => `${file}:${declaration.line} ${rule.selector} reads ${name}`),
      ),
    );
    expect(drawn.size).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });
});
