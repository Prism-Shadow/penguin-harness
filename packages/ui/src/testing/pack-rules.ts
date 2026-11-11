/**
 * The cleanliness rules a theme pack's stylesheets can be held to statically (06 「干净的底线」,
 * R1–R11): what a pack may not ADD to a page — decoration off its homes, chrome on rows, a second
 * carrier for a state, a per-element type or spacing step, a doubled line, a rough chart, a rule
 * that exists in dark only, motion off the live homes. R3, R4 and R12 are measured or reviewed,
 * not read from the CSS; the suite runs these over every pack folder.
 *
 * A check reads a pack's sources ({@link readPackSources}), skips the token and accent rules (they
 * declare custom properties only) and `@keyframes` steps, and reports hits: rule, file, line, what
 * it found. The built-in packs predate the rules; the suite holds each to the count of hits it has
 * today, which only shrinks, and a new pack to none.
 *
 * The homes each rule names are the hooks that exist (hooks.ts); a hook a later pack round adds
 * (the control edge, the start page's brand slot, an empty state's art slot) joins its rule's homes
 * with that hook.
 */
import { parseCssRules, selectorList } from "./css";
import type { CssDeclaration, CssStyleRule } from "./css";
import { GRADIENT_RECIPES } from "./deslop";
import type { ThemeSource } from "./theme-tokens";

export const PACK_RULES = {
  R1: "decoration only on its homes: no image, gradient, mask or cut-out shape elsewhere (R1, R2)",
  R5: "no new chrome on rows: a pseudo-element paints only in a hook's own home",
  R6: "a state keeps one carrier: a state rule sets colour, fill, weight or opacity only",
  R7: "the type and spacing scale moves only through tokens: no per-element size or spacing",
  R8: "one weight of line: no shadow on a boxed host, and an outline only under keyboard focus",
  R9: "charts say the data: strokes, colour fills, opacity and corner radii only",
  R10: "dark is the same theme at night: no recipe that exists in dark only",
  R11: "motion is the base's: an animation or a transition only in a live home",
} as const;

export type PackRule = keyof typeof PACK_RULES;

export interface PackRuleHit {
  readonly rule: PackRule;
  /** The stylesheet, relative to the pack's folder. */
  readonly file: string;
  readonly line: number;
  readonly found: string;
}

/** Each selector of a rule, its nesting parents prefixed, whitespace collapsed. */
const selectorsOf = (rule: CssStyleRule): string[] =>
  selectorList(rule.selector).map((selector) =>
    [...rule.parents, selector].join(" ").replace(/\s+/g, " ").trim(),
  );

/** A selector with every `:not(…)` removed: a negated state selects the resting rows. */
function withoutNegations(selector: string): string {
  let out = "";
  for (let i = 0; i < selector.length; i++) {
    if (selector.startsWith(":not(", i)) {
      let depth = 0;
      for (i += 4; i < selector.length; i++) {
        if (selector[i] === "(") depth++;
        else if (selector[i] === ")" && --depth === 0) break;
      }
      continue;
    }
    out += selector[i];
  }
  return out;
}

/** R1: an image, a gradient, a mask or a cut-out shape. */
const DECORATION =
  /^(?:background|background-image|-webkit-mask|-webkit-mask-image|mask|mask-image|border-image|border-image-source|list-style-image)$/;
const IMAGE_VALUE = /\burl\(|image-set\(|gradient\(/;
const SHAPE_VALUE = /\b(?:shape|path|polygon)\(/;
/** R1's homes: the frosted layer, and the gradients that carry a state or the data's shape. */
const DECORATION_HOMES = [/\.ui-glass\b/, GRADIENT_RECIPES];

/** R5's homes: the hooks whose own anatomy is drawn with a pseudo-element. */
const PSEUDO_HOMES = [
  /\.ui-tree\b/,
  /\.ui-notice\b/,
  /\.ui-underline-nav\b/,
  /\.ui-stream\b/,
  /\.ui-activity\b.*\[data-slot="progress"\]/,
];
const PSEUDO = /::?(?:before|after)\b/;

/** R6: what makes a rule a state's: the subject or an ancestor in a state. */
const STATE = /\[(?:data-state|aria-current|aria-selected)\b/;
const STATE_PROPERTIES = new Set(["color", "background-color", "font-weight", "opacity"]);

/** R7: per-element type and spacing. */
const SCALE =
  /^(?:font-size|line-height|letter-spacing|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|gap|row-gap|column-gap)$/;

/** R8: the boxed hosts, which never take a shadow. */
const BOXED_HOSTS = /\.ui-(?:frame|notice|widget)\b/;
const OUTLINE = /^outline(?:-(?:style|width|color))?$/;

/** R9: what a chart mark may set. */
const CHART_PROPERTIES = /^(?:stroke(?:-[a-z-]+)?|fill|fill-opacity|opacity|rx|ry)$/;

/** R11: the homes of motion. */
const MOTION = /^(?:animation|transition)(?:-[a-z-]+)?$/;
const MOTION_HOMES = [/\.ui-live\b/, /\.ui-stream\b/, /\.ui-activity\[data-state="running"\]/];

const none = (value: string) => /^(?:none|0|0px)$/.test(value.trim());
const custom = (d: CssDeclaration) => d.name.startsWith("--");
const inHome = (selectors: readonly string[], homes: readonly RegExp[]) =>
  selectors.every((selector) => homes.some((home) => home.test(selector)));

/** Every hit of the rules in one pack's stylesheets, in file and line order. */
export function packRuleHits(sources: readonly ThemeSource[]): PackRuleHit[] {
  const hits: PackRuleHit[] = [];
  const parsed = sources.flatMap((source) =>
    parseCssRules(source.css)
      .filter((rule) => !rule.atRules.some((at) => at.startsWith("@keyframes")))
      .filter((rule) => !rule.declarations.every(custom))
      .map((rule) => ({ file: source.file, rule, selectors: selectorsOf(rule) })),
  );
  const everySelector = new Set(parsed.flatMap(({ selectors }) => selectors));

  for (const { file, rule, selectors } of parsed) {
    const hit = (code: PackRule, line: number, found: string) =>
      hits.push({ rule: code, file, line, found: `${rule.selector} { ${found} }` });
    const declared = rule.declarations.filter((d) => !custom(d));
    // A state rule in a live home — the running label's sweep, the streaming caret — is that
    // state's own rendering, which R1 and R11 already bound.
    const stated =
      selectors.some((selector) => STATE.test(withoutNegations(selector))) &&
      !inHome(selectors, [...MOTION_HOMES, GRADIENT_RECIPES]);
    const pseudo = selectors.some((selector) => PSEUDO.test(selector));
    const chart = selectors.some((selector) => /\.ui-chart\b/.test(selector));

    for (const d of declared) {
      const found = `${d.name}: ${d.value}`;
      const decoration =
        (DECORATION.test(d.name) && IMAGE_VALUE.test(d.value)) ||
        (d.name === "clip-path" && SHAPE_VALUE.test(d.value));
      if (decoration && !inHome(selectors, DECORATION_HOMES)) hit("R1", d.line, found);
      if (stated && !STATE_PROPERTIES.has(d.name)) hit("R6", d.line, found);
      if (SCALE.test(d.name)) hit("R7", d.line, found);
      if (d.name === "box-shadow" && !none(d.value) && selectors.some((s) => BOXED_HOSTS.test(s))) {
        hit("R8", d.line, found);
      }
      if (
        OUTLINE.test(d.name) &&
        !none(d.value) &&
        !selectors.every((s) => /:focus-visible/.test(s))
      ) {
        hit("R8", d.line, found);
      }
      if (
        chart &&
        (!CHART_PROPERTIES.test(d.name) || (d.name === "fill" && /url\(/.test(d.value)))
      ) {
        hit("R9", d.line, found);
      }
      if (MOTION.test(d.name) && !none(d.value) && !inHome(selectors, MOTION_HOMES)) {
        hit("R11", d.line, found);
      }
    }
    // R5: a pseudo-element that does more than switch itself off, outside its hook's home.
    const hidesOnly = declared.every(
      (d) => (d.name === "content" || d.name === "display") && none(d.value),
    );
    if (pseudo && !hidesOnly && !inHome(selectors, PSEUDO_HOMES)) {
      hit("R5", rule.line, declared.map((d) => d.name).join(", "));
    }
    // R10: a recipe for dark whose light twin the pack never writes.
    for (const selector of selectors) {
      if (!/\.dark\b/.test(selector)) continue;
      const light = selector
        .replace(/\.dark\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!everySelector.has(light)) hit("R10", rule.line, `${selector} has no light rule`);
    }
  }
  return hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}
