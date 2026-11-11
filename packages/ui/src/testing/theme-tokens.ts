/**
 * Reading a theme pack (`src/themes/<id>/`) the way the token contract describes it, for the
 * contract and contrast tests — and for anyone filling a theme who wants the list of what is
 * still missing without running the suite.
 *
 * A pack is a folder: its manifest (`pack.json`), and an `index.css` that imports the pack's
 * stylesheets by relative path, each in its cascade layer — `@import "./tokens.css"
 * layer(ui-theme);`. The stylesheets carry no `@layer` of their own; {@link readPackSources}
 * follows the imports in cascade order and records the layer each file is served in, and the
 * analysis reads a rule as sitting in that layer.
 *
 * The token rules sit on fixed selectors, in a fixed layer:
 *
 *   the base (Frost)   base `:root`                     dark `:root.dark`                  ui-base
 *   any other pack     base `:root[data-theme="<id>"]`  dark `:root[data-theme="<id>"].dark`  ui-theme
 *
 * The base rule declares contract names with their light values, plus the gray bridge that
 * re-points Tailwind's own palette variables. The dark rule matches the same root and declares
 * only what dark changes, so a mode is the base rule overlaid with that mode's own rule (light has
 * none of its own). Nothing else is a token. The base pack and every pack on the foundation alone
 * (`base: "foundation"`) declare every name in both modes; a pack built on Frost may declare only
 * what it changes, and the rest resolves to Frost's ({@link resolveThemeValue}).
 *
 * The accent presets (the manifest's `accent.presets`) sit in `ui-accent`, each on the pack's
 * root with `[data-accent="<id>"]` — the base's too, so a pack built on Frost never shows Frost's
 * presets — and optionally a `.dark` rule that lifts the preset for dark mode:
 *
 *   light `:root[data-theme="<id>"][data-accent="x"]`   dark `…[data-accent="x"].dark`
 *
 * A preset's light rule sets `--ui-accent` and nothing outside the accent group; its dark rule
 * declares only what dark changes. In a mode a preset overlays the theme's values for that mode.
 * The accent tokens a preset leaves alone must follow it anyway: the theme derives them from
 * `--ui-accent` (a `var(--ui-accent)` in their value), or — for the label ink alone — the
 * theme's own ink for the mode, whose pairing with every preset the contrast suite measures.
 * Primer's presets set all six literally (the app's pixels are pinned), which satisfies this
 * trivially.
 *
 * A custom property whose name starts with `--_` is private to the recipes (theme.css's own
 * convention: a tone's resolved ink, a tree row's depth) and is not a token: the analysis skips it
 * wherever it is declared.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { INITIAL_THEME_ID, THEME_MODES, TOKEN_GROUPS, TOKEN_NAMES } from "../tokens";
import type { ThemeModeName } from "../tokens";
import { parseCssRules, selectorList, stripCssComments } from "./css";
import type { CssDeclaration } from "./css";

/** The layer the base pack's rules live in, under every other pack's. */
export const BASE_LAYER = "@layer ui-base";

/** The layer every other pack's rules live in, so a user accent preset (`@layer ui-accent`) beats it. */
export const THEME_LAYER = "@layer ui-theme";

/** The layer a theme's accent presets live in: after `ui-theme`, so a preset beats the dark rule. */
export const ACCENT_LAYER = "@layer ui-accent";

/** The four layers theme.css opens, in cascade order. */
export const UI_LAYERS = ["ui-base", "ui-theme", "ui-accent", "ui-font"] as const;

/** The names a preset may set: the contract's accent group, and nothing outside it. */
export const ACCENT_TOKEN_NAMES: readonly string[] =
  TOKEN_GROUPS.find((group) => group.id === "color-accent")?.names ?? [];

/** Tailwind palette variables a theme may re-point: the gray bridge, plus white and black. */
export const BRIDGE_VARIABLE = /^--color-(?:white|black|gray-(?:50|[1-9]00|950))$/;

/** The eleven gray steps. A complete pack re-points all of them, and white (see below). */
export const GRAY_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** Marker a stub theme file carries in its header comment until its tokens are written. */
export const STUB_MARKER = "Stub:";

/** The built-in packs' folder, `packages/ui/src/themes/`. */
export const THEMES_DIR = fileURLToPath(new URL("../themes/", import.meta.url));

const CONTRACT = new Set<string>(TOKEN_NAMES);

/** A recipe's private custom property, which is not a token. */
const PRIVATE_PROPERTY = /^--_/;

/** One stylesheet of a pack: where it lives (for the messages), its text, and its layer. */
export interface ThemeSource {
  /** The path relative to the pack's folder, `/`-separated. */
  readonly file: string;
  readonly css: string;
  /** The layer the file is served in (`ui-theme`), or null for a file imported without one. */
  readonly layer: string | null;
}

/** A relative `@import`, with the layer it serves the file in: `@import "./a.css" layer(ui-base);`. */
const PACK_IMPORT = /@import\s+["'](\.{1,2}\/[^"']+)["'](?:\s+layer\(\s*([\w-]+)\s*\))?\s*;/g;

/**
 * The stylesheets of one pack in the order the cascade reads them: each file `index.css` imports
 * by relative path — its own imports first, a file imported without a layer taking its importer's
 * — and then `index.css` itself. Package imports (`@prismshadow/…`) are not the pack's.
 */
export function readPackSources(packDir: string): ThemeSource[] {
  const sources: ThemeSource[] = [];
  const visit = (path: string, layer: string | null) => {
    const css = readFileSync(path, "utf8");
    for (const match of stripCssComments(css).matchAll(PACK_IMPORT)) {
      visit(join(dirname(path), match[1]!), match[2] ?? layer);
    }
    sources.push({ file: relative(packDir, path).split("\\").join("/"), css, layer });
  };
  visit(join(packDir, "index.css"), null);
  return sources;
}

/** The ids of the pack folders under `themesDir`: every folder holding a `pack.json`, sorted. */
export function packFolders(themesDir: string = THEMES_DIR): string[] {
  return readdirSync(themesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(themesDir, entry.name, "pack.json")))
    .map((entry) => entry.name)
    .sort();
}

/** Reads and analyzes the pack in `themesDir/<id>/`. */
export function analyzePack(id: string, themesDir: string = THEMES_DIR): ThemeFileAnalysis {
  return analyzeThemeFile(readPackSources(join(themesDir, id)), id);
}

/** Whether `themeId` is the base pack, whose rules sit on the bare root in `ui-base`. */
const isBase = (themeId: string) => themeId === INITIAL_THEME_ID;

/** The canonical selector list of a theme's rule for one mode. */
export function themeSelectors(themeId: string, mode: ThemeModeName): string[] {
  const suffix = mode === "dark" ? ".dark" : "";
  return isBase(themeId) ? [`:root${suffix}`] : [`:root[data-theme="${themeId}"]${suffix}`];
}

/** The layer a theme's token rules and recipes sit in. */
export function themeLayer(themeId: string): string {
  return isBase(themeId) ? BASE_LAYER : THEME_LAYER;
}

/** The canonical selector list of one accent preset's rule for one mode. */
export function accentSelectors(themeId: string, presetId: string, mode: ThemeModeName): string[] {
  const suffix = mode === "dark" ? ".dark" : "";
  return [`:root[data-theme="${themeId}"][data-accent="${presetId}"]${suffix}`];
}

/** One preset's rules: the light rule (it applies in both modes) and the dark rule alone. */
export interface AccentPresetRules {
  readonly light: ReadonlyMap<string, string>;
  readonly dark: ReadonlyMap<string, string>;
}

export interface ThemeFileAnalysis {
  readonly themeId: string;
  /**
   * Custom properties each canonical rule declares itself, name → value: `light` is the base rule
   * (it applies in both modes), `dark` the dark rule alone. {@link modeDeclarations} gives what a
   * mode resolves to.
   */
  readonly modes: Readonly<Record<ThemeModeName, ReadonlyMap<string, string>>>;
  /** The theme's accent presets, id → rules, in the order the files declare them. */
  readonly accents: ReadonlyMap<string, AccentPresetRules>;
  /** True once any rule in the pack declares a `--ui-*` property. */
  readonly declaresTokens: boolean;
  /** True while a header still carries {@link STUB_MARKER} and nothing is declared. */
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

/**
 * Reads a theme: one stylesheet's text (its rules' layers as written), or a pack's sources
 * ({@link readPackSources}), whose rules sit in the layer each file is served in and whose
 * problems name the file they are in.
 */
export function analyzeThemeFile(
  input: string | readonly ThemeSource[],
  themeId: string,
): ThemeFileAnalysis {
  const sources: readonly ThemeSource[] =
    typeof input === "string" ? [{ file: "", css: input, layer: null }] : input;
  const rules = sources.flatMap((source) =>
    parseCssRules(source.css).map((rule) => ({
      rule,
      file: source.file,
      atRules: source.layer === null ? rule.atRules : [`@layer ${source.layer}`, ...rule.atRules],
    })),
  );
  const modes = { light: new Map<string, string>(), dark: new Map<string, string>() };
  const firstLine = { light: new Map<string, string>(), dark: new Map<string, string>() };
  const accents = new Map<string, { light: Map<string, string>; dark: Map<string, string> }>();
  const structure: string[] = [];
  const layer = themeLayer(themeId);
  let declaresTokens = false;

  for (const { rule, file, atRules } of rules) {
    const at = (line: number) => (file === "" ? `line ${line}` : `${file} line ${line}`);
    const custom = rule.declarations.filter(
      (d: CssDeclaration) => d.name.startsWith("--") && !PRIVATE_PROPERTY.test(d.name),
    );
    if (rule.declarations.some((d) => d.name.startsWith("--ui-"))) declaresTokens = true;
    if (custom.length === 0) continue;
    const selectors = selectorList(rule.selector);

    const preset = presetOf(selectors);
    if (preset !== null) {
      const mode = THEME_MODES.find((m) => sameSet(selectors, accentSelectors(themeId, preset, m)));
      if (mode === undefined) {
        structure.push(
          `${at(rule.line)}: \`${rule.selector}\` declares ${custom[0]!.name} — a preset's rules are ` +
            `${THEME_MODES.map((m) => `\`${accentSelectors(themeId, preset, m).join(", ")}\``).join(" / ")}`,
        );
        continue;
      }
      const layered =
        rule.parents.length === 0 && atRules.length === 1 && atRules[0] === ACCENT_LAYER;
      if (!layered) {
        const where = [...atRules, ...rule.parents].join(" › ") || "top level";
        structure.push(
          `${at(rule.line)}: the ${preset} preset's ${mode} rule sits in ${where}; it must sit ` +
            `directly in \`${ACCENT_LAYER}\` so it overrides the theme's dark rule by layer order`,
        );
      }
      const entry = accents.get(preset) ?? { light: new Map(), dark: new Map() };
      for (const declaration of custom) {
        if (entry[mode].has(declaration.name)) {
          structure.push(
            `${at(declaration.line)}: ${declaration.name} is declared again for the ${preset} preset (${mode}); the later one silently wins`,
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
        `${at(rule.line)}: \`${rule.selector}\` declares ${custom[0]!.name} — tokens belong in the ` +
          `canonical rules (${THEME_MODES.map((m) => `\`${themeSelectors(themeId, m).join(", ")}\``).join(" / ")})`,
      );
      continue;
    }
    if (rule.parents.length > 0 || atRules.length !== 1 || atRules[0] !== layer) {
      const where = [...atRules, ...rule.parents].join(" › ") || "top level";
      structure.push(
        `${at(rule.line)}: the ${mode} rule sits in ${where}; it must sit directly in \`${layer}\` ` +
          `so the cascade puts it ${layer === BASE_LAYER ? "under every pack" : "over the base"} and the user's accent presets (\`@layer ui-accent\`) override it`,
      );
    }
    for (const declaration of custom) {
      const seen = firstLine[mode].get(declaration.name);
      if (seen !== undefined) {
        structure.push(
          `${at(declaration.line)}: ${declaration.name} is declared again for ${mode} (first at ${seen}); the later one silently wins`,
        );
      } else firstLine[mode].set(declaration.name, at(declaration.line));
      modes[mode].set(declaration.name, declaration.value);
    }
  }

  return {
    themeId,
    modes,
    accents,
    declaresTokens,
    isStub: !declaresTokens && sources.some((source) => source.css.includes(STUB_MARKER)),
    structure,
  };
}

/** A value that follows `--ui-accent`: it reads the token (with or without a fallback). */
const DERIVED_FROM_ACCENT = /var\(\s*--ui-accent\s*[,)]/;

/**
 * Problems with a theme's accent presets against the list its manifest declares: the ids and
 * their order, a light rule that sets `--ui-accent` and only accent names, a dark rule that sets
 * only accent names and only what dark changes, values that resolve, every accent token a preset
 * leaves alone derived from `--ui-accent` by the theme (the label ink excepted — the contrast
 * suite measures it against every preset), and the swatch the manifest carries for each preset
 * equal to the `--ui-accent` its light rule sets. `base` is the base pack's analysis, which a
 * pack built on Frost takes the derivations it leaves out from.
 */
export function accentProblems(
  analysis: ThemeFileAnalysis,
  expected: readonly { readonly id: string; readonly swatch: string }[],
  base: ThemeFileAnalysis | null = null,
): string[] {
  const problems: string[] = [];
  const declared = [...analysis.accents.keys()];
  const expectedIds = expected.map((preset) => preset.id);
  if (declared.join(",") !== expectedIds.join(",")) {
    problems.push(
      `the presets are [${declared.join(", ")}]; the manifest lists [${expectedIds.join(", ")}] in that order`,
    );
  }
  for (const { id, swatch } of expected) {
    const rules = analysis.accents.get(id);
    if (rules === undefined) continue;
    if (!rules.light.has("--ui-accent")) {
      problems.push(`${id}: the light rule does not set --ui-accent`);
    }
    for (const mode of THEME_MODES) {
      // A token the preset does not set in this mode takes the theme's value for the mode, which
      // must be a derivation of `--ui-accent` — otherwise the theme's own hover, wash or line
      // would show under the preset's accent.
      const themeValues = new Map([
        ...(base === null || base === analysis ? [] : modeDeclarations(base, mode)),
        ...modeDeclarations(analysis, mode),
      ]);
      for (const name of ACCENT_TOKEN_NAMES) {
        if (name === "--ui-accent" || name === "--ui-accent-fg") continue;
        if (rules.light.has(name) || (mode === "dark" && rules.dark.has(name))) continue;
        const value = themeValues.get(name);
        if (value === undefined || !DERIVED_FROM_ACCENT.test(value)) {
          problems.push(
            `${id}: ${name} (${mode}) is neither set by the preset nor derived from --ui-accent by the theme (${value ?? "undeclared"})`,
          );
        }
      }
    }
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
        `${id}: the manifest carries the swatch ${swatch}, the light rule sets --ui-accent: ${accent}`,
      );
    }
  }
  return problems;
}

/**
 * What one mode of a theme defines within its own pack: the base rule, overlaid in dark with the
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

/** How much of the contract a pack must declare. */
export interface ContractOptions {
  /**
   * True (the default) for the base and for a pack on the foundation alone: every name, and the
   * whole gray bridge. False for a pack built on Frost, which may leave names to Frost.
   */
  readonly complete?: boolean;
}

/**
 * Contract problems for one mode — the base rule plus that mode's own: missing names (for a
 * complete pack), names outside the contract, bad values.
 */
export function contractProblems(
  analysis: ThemeFileAnalysis,
  mode: ThemeModeName,
  { complete = true }: ContractOptions = {},
): string[] {
  const declared = modeDeclarations(analysis, mode);
  const problems: string[] = [];
  const missing = complete ? TOKEN_NAMES.filter((name) => !declared.has(name)) : [];
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
  if (complete) {
    // The base's rules match every <html> (`:root`, `:root.dark`), so a bridge step a complete
    // pack leaves alone renders in the base's value — the palette classes the app still spells
    // would mix two themes on one screen.
    const bridge = ["--color-white", ...GRAY_STEPS.map((step) => `--color-gray-${step}`)];
    const holes = bridge.filter((name) => !declared.has(name));
    if (holes.length > 0) {
      problems.push(`the gray bridge is incomplete — re-point ${holes.join(", ")}`);
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
 * layers produce: an applied accent preset's rules first (its dark rule, then its light one —
 * they sit in `ui-accent`, after every theme rule), then the mode's own rule, then (dark only)
 * the same theme's base rule, which the dark `<html>` also matches and which sits in a layer
 * above the base pack's, then the base pack's rules (`ui-base`), which match every `<html>`.
 * `var()` references are substituted recursively, fallbacks honoured. `null` when unresolvable.
 */
export function resolveThemeValue(
  name: string,
  mode: ThemeModeName,
  theme: ThemeFileAnalysis,
  base: ThemeFileAnalysis,
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
  if (base !== theme) push(base);

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
