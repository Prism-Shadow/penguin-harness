/**
 * Reading a theme file (`src/themes/<id>.css`) the way the token contract describes it, for the
 * contract and contrast tests — and for anyone filling a theme who wants the list of what is
 * still missing without running the suite.
 *
 * A theme file is one `@layer ui-theme` block with a base rule and a dark rule on fixed
 * selectors (tokens.ts, `themes/github.css`):
 *
 *   default theme   base `:root, :root[data-theme="github"]`   dark `:root.dark, :root[data-theme="github"].dark`
 *   any other       base `:root[data-theme="<id>"]`             dark `:root[data-theme="<id>"].dark`
 *
 * The base rule declares every contract name with its light value, plus the gray bridge that
 * re-points Tailwind's own palette variables. The dark rule matches the same root and declares
 * only what dark changes, so a mode is the base rule overlaid with that mode's own rule (light has
 * none of its own). Nothing else is a token.
 *
 * After the theme block, one `@layer ui-accent` block holds the theme's own accent presets
 * (tokens.ts, `ACCENT_PRESETS`), each on the theme's root with `[data-accent="<id>"]` — the
 * default theme's on a bare root as well, spelled `:root:not([data-theme])` so it never matches
 * another theme's root — and optionally a `.dark` rule that lifts the preset for dark mode:
 *
 *   default theme   light `:root:not([data-theme])[data-accent="x"], :root[data-theme="github"][data-accent="x"]`
 *   any other       light `:root[data-theme="<id>"][data-accent="x"]`   dark `…[data-accent="x"].dark`
 *
 * A preset's light rule sets the six accent tokens and nothing else; its dark rule declares only
 * what dark changes. In a mode a preset overlays the theme's values for that mode.
 */
import { DEFAULT_THEME_ID, THEME_MODES, TOKEN_GROUPS, TOKEN_NAMES } from "../tokens";
import type { ThemeId, ThemeModeName } from "../tokens";
import { parseCssRules, selectorList } from "./css";
import type { CssDeclaration } from "./css";

/** The layer every theme block lives in, so a user accent preset (`@layer ui-accent`) beats it. */
export const THEME_LAYER = "@layer ui-theme";

/** The layer a theme's accent presets live in: after `ui-theme`, so a preset beats the dark rule. */
export const ACCENT_LAYER = "@layer ui-accent";

/** The six names a preset sets: the contract's accent group, and nothing outside it. */
export const ACCENT_TOKEN_NAMES: readonly string[] =
  TOKEN_GROUPS.find((group) => group.id === "color-accent")?.names ?? [];

/** Tailwind palette variables a theme may re-point: the gray bridge, plus white and black. */
export const BRIDGE_VARIABLE = /^--color-(?:white|black|gray-(?:50|[1-9]00|950))$/;

/** The eleven gray steps. A non-default theme re-points all of them, in its base rule (see below). */
export const GRAY_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** Marker a stub theme file carries in its header comment until its tokens are written. */
export const STUB_MARKER = "Stub:";

const CONTRACT = new Set<string>(TOKEN_NAMES);

/** The canonical selector list of a theme's rule for one mode. */
export function themeSelectors(themeId: ThemeId, mode: ThemeModeName): string[] {
  const attr = `:root[data-theme="${themeId}"]`;
  const suffix = mode === "dark" ? ".dark" : "";
  return themeId === DEFAULT_THEME_ID
    ? [`:root${suffix}`, `${attr}${suffix}`]
    : [`${attr}${suffix}`];
}

/** The canonical selector list of one accent preset's rule for one mode. */
export function accentSelectors(themeId: ThemeId, presetId: string, mode: ThemeModeName): string[] {
  const attr = `[data-accent="${presetId}"]`;
  const suffix = mode === "dark" ? ".dark" : "";
  const own = `:root[data-theme="${themeId}"]${attr}${suffix}`;
  return themeId === DEFAULT_THEME_ID ? [`:root:not([data-theme])${attr}${suffix}`, own] : [own];
}

/** One preset's rules: the light rule (it applies in both modes) and the dark rule alone. */
export interface AccentPresetRules {
  readonly light: ReadonlyMap<string, string>;
  readonly dark: ReadonlyMap<string, string>;
}

export interface ThemeFileAnalysis {
  readonly themeId: ThemeId;
  /**
   * Custom properties each canonical rule declares itself, name → value: `light` is the base rule
   * (it applies in both modes), `dark` the dark rule alone. {@link modeDeclarations} gives what a
   * mode resolves to.
   */
  readonly modes: Readonly<Record<ThemeModeName, ReadonlyMap<string, string>>>;
  /** The theme's accent presets, id → rules, in the order the file declares them. */
  readonly accents: ReadonlyMap<string, AccentPresetRules>;
  /** True once any rule in the file declares a `--ui-*` property. */
  readonly declaresTokens: boolean;
  /** True while the header still carries {@link STUB_MARKER} and nothing is declared. */
  readonly isStub: boolean;
  /** Shape problems: token declarations outside the canonical rules or layer, duplicates. */
  readonly structure: readonly string[];
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((s) => b.includes(s));

/** The one preset id a selector list names, or null when it names none (or several). */
function presetOf(selectors: readonly string[]): string | null {
  const ids = new Set(
    selectors.map((selector) => /\[data-accent="([\w-]+)"\]/.exec(selector)?.[1] ?? ""),
  );
  const [id, ...rest] = [...ids];
  return id !== undefined && id !== "" && rest.length === 0 ? id : null;
}

export function analyzeThemeFile(css: string, themeId: ThemeId): ThemeFileAnalysis {
  const rules = parseCssRules(css);
  const modes = { light: new Map<string, string>(), dark: new Map<string, string>() };
  const firstLine = { light: new Map<string, number>(), dark: new Map<string, number>() };
  const accents = new Map<string, { light: Map<string, string>; dark: Map<string, string> }>();
  const structure: string[] = [];
  let declaresTokens = false;

  for (const rule of rules) {
    const custom = rule.declarations.filter((d: CssDeclaration) => d.name.startsWith("--"));
    if (rule.declarations.some((d) => d.name.startsWith("--ui-"))) declaresTokens = true;
    if (custom.length === 0) continue;
    const selectors = selectorList(rule.selector);

    const preset = presetOf(selectors);
    if (preset !== null) {
      const mode = THEME_MODES.find((m) => sameSet(selectors, accentSelectors(themeId, preset, m)));
      if (mode === undefined) {
        structure.push(
          `line ${rule.line}: \`${rule.selector}\` declares ${custom[0]!.name} — a preset's rules are ` +
            `${THEME_MODES.map((m) => `\`${accentSelectors(themeId, preset, m).join(", ")}\``).join(" / ")}`,
        );
        continue;
      }
      const layered =
        rule.parents.length === 0 && rule.atRules.length === 1 && rule.atRules[0] === ACCENT_LAYER;
      if (!layered) {
        const where = [...rule.atRules, ...rule.parents].join(" › ") || "top level";
        structure.push(
          `line ${rule.line}: the ${preset} preset's ${mode} rule sits in ${where}; it must sit ` +
            `directly in \`${ACCENT_LAYER}\` so it overrides the theme's dark rule by layer order`,
        );
      }
      const entry = accents.get(preset) ?? { light: new Map(), dark: new Map() };
      for (const declaration of custom) {
        if (entry[mode].has(declaration.name)) {
          structure.push(
            `line ${declaration.line}: ${declaration.name} is declared again for the ${preset} preset (${mode}); the later one silently wins`,
          );
        }
        entry[mode].set(declaration.name, declaration.value);
      }
      accents.set(preset, entry);
      continue;
    }

    const mode = THEME_MODES.find((m) => sameSet(selectors, themeSelectors(themeId, m)));
    if (mode === undefined) {
      structure.push(
        `line ${rule.line}: \`${rule.selector}\` declares ${custom[0]!.name} — tokens belong in the ` +
          `canonical rules (${THEME_MODES.map((m) => `\`${themeSelectors(themeId, m).join(", ")}\``).join(" / ")})`,
      );
      continue;
    }
    if (rule.parents.length > 0 || rule.atRules.length !== 1 || rule.atRules[0] !== THEME_LAYER) {
      const where = [...rule.atRules, ...rule.parents].join(" › ") || "top level";
      structure.push(
        `line ${rule.line}: the ${mode} rule sits in ${where}; it must sit directly in \`${THEME_LAYER}\` ` +
          `so the user's accent presets (\`@layer ui-accent\`) override it`,
      );
    }
    for (const declaration of custom) {
      const seen = firstLine[mode].get(declaration.name);
      if (seen !== undefined) {
        structure.push(
          `line ${declaration.line}: ${declaration.name} is declared again for ${mode} (first at line ${seen}); the later one silently wins`,
        );
      } else firstLine[mode].set(declaration.name, declaration.line);
      modes[mode].set(declaration.name, declaration.value);
    }
  }

  return {
    themeId,
    modes,
    accents,
    declaresTokens,
    isStub: !declaresTokens && css.includes(STUB_MARKER),
    structure,
  };
}

/**
 * Problems with a theme's accent presets against the list tokens.ts declares for it: the ids
 * and their order, a light rule that sets exactly the six accent names, a dark rule that sets
 * only accent names and only what dark changes, values that resolve, and the swatch tokens.ts
 * carries for each preset equal to the `--ui-accent` its light rule sets.
 */
export function accentProblems(
  analysis: ThemeFileAnalysis,
  expected: readonly { readonly id: string; readonly swatch: string }[],
): string[] {
  const problems: string[] = [];
  const declared = [...analysis.accents.keys()];
  const expectedIds = expected.map((preset) => preset.id);
  if (declared.join(",") !== expectedIds.join(",")) {
    problems.push(
      `the presets are [${declared.join(", ")}]; tokens.ts lists [${expectedIds.join(", ")}] in that order`,
    );
  }
  for (const { id, swatch } of expected) {
    const rules = analysis.accents.get(id);
    if (rules === undefined) continue;
    const missing = ACCENT_TOKEN_NAMES.filter((name) => !rules.light.has(name));
    if (missing.length > 0) problems.push(`${id}: the light rule leaves out ${missing.join(", ")}`);
    for (const [mode, values] of [
      ["light", rules.light],
      ["dark", rules.dark],
    ] as const) {
      for (const [name, value] of values) {
        if (!ACCENT_TOKEN_NAMES.includes(name)) {
          problems.push(`${id}: the ${mode} rule sets ${name}, which is not an accent token`);
        }
        if (value === "") problems.push(`${id}: ${name} (${mode}) has an empty value`);
        for (const ref of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
          if (!CONTRACT.has(ref[1]!)) {
            problems.push(`${id}: ${name} (${mode}) reads ${ref[1]}, not a contract token`);
          }
        }
        if (mode === "dark" && rules.light.get(name) === value) {
          problems.push(
            `${id}: the dark rule repeats ${name}: ${value} — drop it from the dark rule`,
          );
        }
      }
    }
    const accent = rules.light.get("--ui-accent");
    if (accent !== undefined && accent !== swatch) {
      problems.push(
        `${id}: tokens.ts carries the swatch ${swatch}, the light rule sets --ui-accent: ${accent}`,
      );
    }
  }
  return problems;
}

/**
 * What one mode of a theme defines within its own file: the base rule, overlaid in dark with the
 * dark rule. `:root.dark` also matches the base rule, so a name the dark rule leaves out keeps its
 * base value.
 */
export function modeDeclarations(
  analysis: ThemeFileAnalysis,
  mode: ThemeModeName,
): ReadonlyMap<string, string> {
  return mode === "light"
    ? analysis.modes.light
    : new Map([...analysis.modes.light, ...analysis.modes.dark]);
}

/**
 * Contract problems for one mode — the base rule plus that mode's own: missing names, names
 * outside the contract, bad values.
 */
export function contractProblems(analysis: ThemeFileAnalysis, mode: ThemeModeName): string[] {
  const declared = modeDeclarations(analysis, mode);
  const problems: string[] = [];
  const missing = TOKEN_NAMES.filter((name) => !declared.has(name));
  if (missing.length > 0) {
    problems.push(`missing ${missing.length} of ${TOKEN_NAMES.length}: ${missing.join(", ")}`);
  }
  for (const [name, value] of declared) {
    if (name.startsWith("--ui-") && !CONTRACT.has(name)) {
      problems.push(`${name} is not in tokens.ts — add it to the contract or remove it`);
    } else if (!name.startsWith("--ui-") && !BRIDGE_VARIABLE.test(name)) {
      problems.push(
        `${name} is neither a contract token nor a bridged Tailwind palette variable (${BRIDGE_VARIABLE})`,
      );
    }
    if (value === "") problems.push(`${name} has an empty value`);
    for (const ref of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const target = ref[1]!;
      if (target.startsWith("--ui-") && !CONTRACT.has(target)) {
        problems.push(`${name} reads ${target}, which is not a contract token`);
      }
    }
  }
  if (analysis.themeId !== DEFAULT_THEME_ID) {
    // The default theme's rules match every <html> (`:root`, `:root.dark`), so a gray step this
    // theme leaves alone renders in the default theme's value — the palette classes the app
    // still spells would mix two themes on one screen.
    const grays = GRAY_STEPS.filter((step) => !declared.has(`--color-gray-${step}`));
    if (grays.length > 0) {
      problems.push(
        `the gray bridge is incomplete — re-point ${grays.map((s) => `--color-gray-${s}`).join(", ")}`,
      );
    }
  }
  return problems;
}

/**
 * Dark-rule declarations that repeat the base rule's value, as `name: value`. The base rule already
 * gives the name that value in dark, so a repeat is a second home for one value — the two drift the
 * first time an edit reaches one of them. The dark rule declares only what dark changes.
 */
export function darkRepeats(analysis: ThemeFileAnalysis): string[] {
  return [...analysis.modes.dark]
    .filter(([name, value]) => analysis.modes.light.get(name) === value)
    .map(([name, value]) => `${name}: ${value}`);
}

/**
 * The value a custom property resolves to for `mode` of a theme, following the cascade the
 * selectors produce: an applied accent preset's rules first (its dark rule, then its light one —
 * they sit in `ui-accent`, after every theme rule), then the mode's own rule, then (dark only)
 * the same theme's base rule, which the dark `<html>` also matches, then the default theme's
 * rules, which match every `<html>`. (Against the default theme's dark rule, another theme's base
 * rule ties on specificity and wins because the theme files are imported after `github.css`.)
 * `var()` references are substituted recursively, fallbacks honoured. `null` when unresolvable.
 */
export function resolveThemeValue(
  name: string,
  mode: ThemeModeName,
  theme: ThemeFileAnalysis,
  defaultTheme: ThemeFileAnalysis,
  preset: AccentPresetRules | null = null,
): string | null {
  const scopes: ReadonlyMap<string, string>[] = [];
  const push = (analysis: ThemeFileAnalysis) => {
    scopes.push(analysis.modes[mode]);
    if (mode === "dark") scopes.push(analysis.modes.light);
  };
  if (preset !== null) {
    if (mode === "dark") scopes.push(preset.dark);
    scopes.push(preset.light);
  }
  push(theme);
  if (defaultTheme !== theme) push(defaultTheme);

  const lookup = (key: string) => {
    for (const scope of scopes) {
      const value = scope.get(key);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  /** Replaces every `var()` in `value`, left to right; `depth` counts reference hops (cycle guard). */
  const substitute = (value: string, depth: number): string | null => {
    if (depth > 32) return null;
    let out = value;
    for (;;) {
      const at = out.indexOf("var(");
      if (at === -1) return out;
      let parens = 0;
      let end = -1;
      for (let i = at + 3; i < out.length; i++) {
        if (out[i] === "(") parens++;
        else if (out[i] === ")" && --parens === 0) {
          end = i;
          break;
        }
      }
      if (end === -1) return null;
      const inner = out.slice(at + 4, end);
      const comma = inner.indexOf(",");
      const ref = (comma === -1 ? inner : inner.slice(0, comma)).trim();
      const fallback = comma === -1 ? undefined : inner.slice(comma + 1).trim();
      const found = lookup(ref);
      const replacement =
        found !== undefined
          ? substitute(found, depth + 1)
          : fallback !== undefined
            ? substitute(fallback, depth + 1)
            : null;
      if (replacement === null) return null;
      out = out.slice(0, at) + replacement + out.slice(end + 1);
    }
  };

  const raw = lookup(name);
  return raw === undefined ? null : substitute(raw, 0);
}
