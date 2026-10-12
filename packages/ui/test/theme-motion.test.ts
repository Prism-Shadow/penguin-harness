/**
 * The theme foundation's motion rules for folds and a run settling (src/theme.css): a source
 * guard, because what a fold's phase does to its track and what reduced motion silences live in
 * the stylesheet alone — no component can show them, and a browser is not in this suite.
 *
 * - A fold's track is `1fr` open or settled, `0fr` closing, and starts at `0fr` when it opens
 *   after mount (`@starting-style`); it never reads `auto`, which cannot be eased.
 * - A run settling eases its slots' ink and nothing else: the transition names `color` alone, on
 *   the theme's duration and curve.
 * - Reduced motion, by the root's switch and by the media query, still silences the layout
 *   motion (so a fold closes at once), the reveal, and the activity family's animations.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCssRules, selectorList } from "../src/testing";
import type { CssStyleRule } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

const RULES = parseCssRules(readFileSync(join(SRC_DIR, "theme.css"), "utf8"));

const STARTING = "@starting-style";
const REDUCED_QUERY = "@media (prefers-reduced-motion: reduce)";

/** The declarations of the rules whose selector list holds `selector` and that `inside` accepts. */
function declared(selector: string, inside: (rule: CssStyleRule) => boolean) {
  return RULES.filter((rule) => selectorList(rule.selector).includes(selector) && inside(rule))
    .flatMap((rule) => rule.declarations)
    .map((d) => `${d.name}: ${d.value}`);
}

const plain = (rule: CssStyleRule) => !rule.atRules.includes(STARTING);
const starting = (rule: CssStyleRule) => rule.atRules.includes(STARTING);

describe("a fold's track", () => {
  it("is 1fr at rest, 0fr closing, and 0fr where an opening body starts", () => {
    expect(declared("[data-layout-motion][data-fold]", plain)).toEqual(["grid-template-rows: 1fr"]);
    expect(declared('[data-layout-motion][data-fold="closing"]', plain)).toEqual([
      "grid-template-rows: 0fr",
    ]);
    expect(declared('[data-layout-motion][data-fold="open"]', starting)).toEqual([
      "grid-template-rows: 0fr",
    ]);
  });

  it("never reads auto in any rule that names a fold", () => {
    const fold = RULES.filter((rule) => rule.selector.includes("[data-fold"));
    expect(fold.length).toBeGreaterThan(0);
    for (const rule of fold) {
      for (const d of rule.declarations) expect(d.value, rule.selector).toMatch(/^[01]fr$/);
    }
  });
});

describe("a run settling", () => {
  it("eases the activity slots' ink alone, on the theme's tokens", () => {
    const selector =
      '.ui-activity :is([data-slot="label"], [data-slot="mark"], [data-slot="detail"])';
    expect(declared(selector, plain)).toEqual([
      "transition: color var(--ui-dur-base) var(--ui-ease-out)",
    ]);
  });
});

describe("reduced motion", () => {
  /** The selectors each reduced-motion block silences, with what it sets. */
  function silenced(inBlock: (rule: CssStyleRule) => boolean) {
    return RULES.filter(inBlock).flatMap((rule) =>
      selectorList(rule.selector).map(
        (sel) => `${sel} { ${rule.declarations.map((d) => `${d.name}: ${d.value}`).join("; ")} }`,
      ),
    );
  }
  const bySwitch = silenced(
    (rule) => rule.atRules.length === 0 && rule.selector.includes(':root[data-motion="reduced"]'),
  );
  const byQuery = silenced((rule) => rule.atRules.includes(REDUCED_QUERY));

  it.each([
    ["the root's switch", bySwitch, ':root[data-motion="reduced"] '],
    ["the media query", byQuery, ""],
  ])("by %s, stills the layout motion, the reveal and the activity family", (_, rules, root) => {
    const has = (pattern: string) => rules.some((line) => line.startsWith(pattern));
    expect(has(`${root}[data-layout-motion] { transition: none }`)).toBe(true);
    expect(
      rules.some(
        (line) =>
          line.startsWith(`${root}:is(`) &&
          line.includes("[data-reveal]") &&
          line.endsWith("{ animation: none }"),
      ),
    ).toBe(true);
    expect(has(`${root}:is(.ui-activity, .ui-activity *) { animation: none }`)).toBe(true);
  });
});
