/**
 * Every component stylesheet under src/components, found by walking the tree so a new one is held
 * without a list. A guard over the CSS itself: what these rules may not do lives in the
 * stylesheet alone, and no component render can show it.
 *
 * - It stays unlayered and free of Tailwind directives (`@layer`, `@apply`, `@reference`,
 *   `@import`): it needs no build pass, and it out-ranks the utilities and the unlayered Markdown
 *   rules it adjusts.
 * - It colours through tokens alone: no hex, `rgb()`, `oklch()` or Tailwind palette variable, and
 *   it switches on `.dark` only for Shiki's own palette.
 * - The Markdown table sheet, which the app's Markdown and the public sites' prose both load, names
 *   no token of either (`--ui-`, `--site-`), so every host's palette and mode can map onto it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripCssComments } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

const ROOT = join(SRC_DIR, "components");
const SHEETS = readdirSync(ROOT, { recursive: true, encoding: "utf8" })
  .filter((rel) => rel.endsWith(".css"))
  .map((rel) => rel.split(/[\\/]/).join("/"))
  .sort();
const rules = (rel: string) => stripCssComments(readFileSync(join(ROOT, rel), "utf8"));

describe("every component stylesheet", () => {
  it("is found by the walk", () => {
    expect(SHEETS.length).toBeGreaterThan(0);
  });

  it.each(SHEETS)("%s stays unlayered and free of Tailwind directives", (rel) => {
    expect(rules(rel)).not.toMatch(/@layer|@apply|@reference|@import/);
  });

  it.each(SHEETS)("%s colours through tokens alone", (rel) => {
    const css = rules(rel);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgb\(|\boklch\(|--color-/i);
    for (const line of css.split("\n").filter((l) => /\.dark\b/.test(l))) {
      expect(line, rel).toMatch(/\.dark \.shiki\b/);
    }
  });
});

describe("the Markdown table stylesheet", () => {
  it("names no token of either host, so every host's palette and mode can map onto it", () => {
    expect(rules("content/prose/markdown-table.css")).not.toMatch(/--ui-|--site-|\.dark\b/);
  });
});
