/**
 * WCAG 2 contrast of the theme tokens, computed from the theme files.
 *
 * The web app used to record its ratios in comments beside `tone.ts`, measured against the two
 * surfaces it had. Three themes × two modes each bring their own surfaces, and a comment cannot
 * follow a value that changes in a file three directories away — so the pairs a reader actually
 * sees are resolved here from the CSS, composited onto what sits behind them, and measured.
 *
 * The pairs (A-architecture §7.2, plus the text pairs every surface implies):
 * - text: `fg` on every surface and the overlay, `fg-muted` on the page surfaces, the link on the
 *   page — 4.5:1;
 * - a tone's ink (`tone-*-fg`) as a glyph or status word on the four page surfaces — 3:1, except
 *   `neutral`, the one tone allowed to recede where its meaning is already in text;
 * - a decorative icon's hue (`icon-tint-*`) as a mark on the four page surfaces and on the
 *   navigation column — 3:1, in every theme, whether or not its recipe paints decorative icons
 *   in them;
 * - a tone's ink on its own tint (`tone-*-bg`, a badge) and a solid badge's label on its fill — 4.5:1;
 * - the accent's label on the accent at rest and on hover (the primary button) — 4.5:1 — and the
 *   accent as a mark on the page and the card (a selected row's `>`, a link-coloured glyph) —
 *   3:1; both for the theme's own accent and, in the second suite, for every preset the theme
 *   lists, overlaid on the theme's values for that mode (a dark lift included);
 * - text and muted text on the shell's two columns, composited onto the field behind the window
 *   (Frost's navigation column is translucent glass on the field) — 4.5:1;
 * - the calm dark (2026-09-29, raised the same day after the owner found the first pass too
 *   dim): in dark, body text at 11:1 or better on the three page surfaces, the muted ink at
 *   6:1 and the subtle ink at 4.5:1; light keeps 7:1 and 4.5:1; the emphasis ink at 4.5:1 in
 *   both;
 * - the switch: its knob on the off track — 3:1, the knob itself or its hairline edge
 *   (`knob-line` over the track) — and, for the theme's accent and every preset, the `knob-on`
 *   on the accent — 3:1, so the knob never vanishes on a near-white dark accent;
 * - the accent's tint, the fill under the person's own words (the user bubble, the steering
 *   chip), for the theme's accent and every preset: body text on it, the steering label's
 *   included, at the page's body-text floor, the tint off the canvas at 1.08:1 so the bubble is
 *   there at all — a tint below a floor is named in TINT_SHORTFALLS, as EXCEPTIONS names a pair
 *   — and the accent's wash laid on the canvas landing on the tint, so a bubble on an image the
 *   page's colour looks as it does on the page.
 *
 * `fg-subtle` has no floor in light — placeholder and disabled ink, which WCAG exempts, and
 * Primer's is the app's — and holds 4.5:1 in dark, where timestamps and meta text read from it.
 *
 * A pair a theme cannot meet yet goes in EXCEPTIONS with the reason and the wave that fixes it; an
 * exception that has started passing fails the suite until it is removed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  THEME_ACCENT_PRESETS,
  THEME_IDS,
  THEME_MODES,
  TONES,
} from "../src/tokens";
import type { ThemeId, ThemeModeName, TokenName } from "../src/tokens";
import {
  BLACK,
  WHITE,
  analyzeThemeFile,
  composite,
  contrastRatio,
  formatColor,
  parseColor,
  resolveThemeValue,
} from "../src/testing";
import type { AccentPresetRules, Rgba, ThemeFileAnalysis } from "../src/testing";
import { ICON_TINT_NAMES } from "../src/components/icons/sets";
import { SRC_DIR } from "./helpers/paths";

interface Pair {
  readonly fg: TokenName;
  readonly bg: TokenName;
  readonly min: number;
}

interface ContrastException {
  readonly theme: ThemeId;
  readonly mode: ThemeModeName;
  readonly fg: TokenName;
  readonly bg: TokenName;
  /** Why the pair is below its floor today. */
  readonly reason: string;
  /** The wave or PR that lifts it. */
  readonly until: string;
}

/**
 * Known shortfalls. Empty is the goal, and it is empty: the last entries — Primer's white knob on
 * its gray-200 track, and its light chart palette at the 500 steps — were lifted on 2026-09-30
 * (a gray-500 hairline on the knob, which the switch check measures as its edge; the 600 steps
 * for the light series). An entry names its fix and the wave that lifts it.
 */
const EXCEPTIONS: readonly ContrastException[] = [];

const PAGE_SURFACES = ["--ui-canvas", "--ui-surface", "--ui-surface-muted", "--ui-inset"] as const;

/**
 * What an accent must clear, the theme's own or a preset's: its label on it, and it as a mark,
 * and the switch knob on it (the on track).
 */
const ACCENT_PAIRS: readonly Pair[] = [
  { fg: "--ui-accent-fg", bg: "--ui-accent", min: 4.5 },
  { fg: "--ui-accent-fg", bg: "--ui-accent-hover", min: 4.5 },
  { fg: "--ui-accent", bg: "--ui-canvas", min: 3 },
  { fg: "--ui-accent", bg: "--ui-surface", min: 3 },
  { fg: "--ui-switch-knob-on", bg: "--ui-accent", min: 3 },
];

/**
 * The ink floors on the three page surfaces, per mode. Light keeps the WCAG floors and exempts
 * the subtle ink (placeholders and disabled text; Primer's is the app's). Dark is held higher
 * on purpose: a first calm dark at 7 / 4.5 read too dim to the owner (2026-09-29), so body text
 * holds 11:1, the muted ink 6:1 and the subtle ink — timestamps, placeholders, meta — 4.5:1.
 */
const INK_FLOORS: Readonly<Record<ThemeModeName, ReadonlyArray<readonly [TokenName, number]>>> = {
  light: [
    ["--ui-fg", 7],
    ["--ui-fg-muted", 4.5],
  ],
  dark: [
    ["--ui-fg", 11],
    ["--ui-fg-muted", 6],
    ["--ui-fg-subtle", 4.5],
  ],
};
const INK_SURFACES = ["--ui-canvas", "--ui-surface", "--ui-surface-muted"] as const;

/**
 * The ink on the accent's tint, per mode: the page's floor for body text. The bubble's text and
 * the steering chip's label are both the body ink — the owner darkened the label from the muted
 * ink so it reads on the tint (2026-10-19) — and the chip's glyph is a mark, not text.
 */
const TINT_INK_FLOORS: Readonly<
  Record<ThemeModeName, ReadonlyArray<readonly [TokenName, number]>>
> = {
  light: INK_FLOORS.light.filter(([fg]) => fg === "--ui-fg"),
  dark: INK_FLOORS.dark.filter(([fg]) => fg === "--ui-fg"),
};

/** How far the tint must stand off the canvas: Primer's gray-100 bubble on white is 1.10:1. */
const TINT_STANDS_OFF = 1.08;

interface TintShortfall {
  readonly theme: ThemeId;
  readonly mode: ThemeModeName;
  /** The ink on the tint, or `--ui-canvas` for the tint's stand-off from the page. */
  readonly pair: TokenName;
  /** The least ratio held in the floor's place, on every accent the theme lists. */
  readonly holds: number;
  /** Why the tint is below the floor, with the neutral bubble's ratio it replaced. */
  readonly reason: string;
  readonly until: string;
}

/**
 * Where the tint is below its floor, kept by the owner's call (2026-10-19): the strengths stay
 * 8 % of the accent in light, 10 % in dark and 12 % for Primer's presets, and body text on a dark
 * tint holds about 10:1, above AAA's 7:1 — the neutral bubble the tint replaced was below the
 * same floor too. An entry no accent needs any more fails the suite until it is removed.
 */
const UNTIL_TINT_FLOORS = "kept by the owner's call on the tint's strengths (2026-10-19)";
const NEAR_WHITE =
  "the theme's own dark accent is a near-white, so its 10 % tint is as light as the gray-800 bubble it replaced";
const TINT_SHORTFALLS: readonly TintShortfall[] = [
  {
    theme: "github",
    mode: "dark",
    pair: "--ui-fg",
    holds: 10,
    reason: `${NEAR_WHITE} (10.06:1; the bubble 10.41:1)`,
    until: UNTIL_TINT_FLOORS,
  },
  {
    theme: "modern",
    mode: "dark",
    pair: "--ui-fg",
    holds: 10,
    reason: `${NEAR_WHITE} (10.14:1; the bubble 10.39:1)`,
    until: UNTIL_TINT_FLOORS,
  },
  {
    theme: "geek",
    mode: "dark",
    pair: "--ui-fg",
    holds: 10,
    reason: `${NEAR_WHITE} (10.15:1; the bubble 10.99:1); gold, phosphor and cyan lift the page a little too (10.75-10.96:1)`,
    until: UNTIL_TINT_FLOORS,
  },
  {
    theme: "geek",
    mode: "dark",
    pair: "--ui-canvas",
    holds: 1.06,
    reason:
      "orange, a saturated red-orange kept unlifted in dark, tints the near-black page by hue more than by lightness (1.07:1, a dark brick)",
    until: UNTIL_TINT_FLOORS,
  },
];

const pairsFor = (mode: ThemeModeName): readonly Pair[] => [
  ...[...PAGE_SURFACES, "--ui-overlay" as const].map((bg) => ({
    fg: "--ui-fg" as const,
    bg,
    min: 4.5,
  })),
  ...INK_FLOORS[mode].flatMap(([fg, min]) => INK_SURFACES.map((bg) => ({ fg, bg, min }))),
  ...(["--ui-canvas", "--ui-surface"] as const).map((bg) => ({
    fg: "--ui-fg-emphasis" as const,
    bg,
    min: 4.5,
  })),
  // The knob on the off track is measured by `knobReads` below: the knob, or its hairline edge.
  // A frosted layer's ink on the glass over the worst backdrop it can float over (black in
  // light, white in dark): a menu stays legible whatever scrolls behind it.
  { fg: "--ui-fg", bg: "--ui-glass-bg", min: 4.5 },
  ...(["--ui-canvas", "--ui-surface"] as const).map((bg) => ({
    fg: "--ui-fg-link" as const,
    bg,
    min: 4.5 as const,
  })),
  ...TONES.filter((tone) => tone !== "neutral").flatMap((tone) =>
    PAGE_SURFACES.map((bg) => ({ fg: `--ui-tone-${tone}-fg` as TokenName, bg, min: 3 as const })),
  ),
  // Where decorative icons sit: a page's empty state and group headers, and the nav column.
  ...ICON_TINT_NAMES.flatMap((tint) => {
    const fg = `--ui-icon-tint-${tint}` as TokenName;
    return [
      ...PAGE_SURFACES.map((bg) => ({ fg, bg, min: 3 as const })),
      { fg, bg: "--ui-shell-nav-bg" as const, min: 3 as const },
    ];
  }),
  ...TONES.flatMap((tone) => [
    {
      fg: `--ui-tone-${tone}-fg` as TokenName,
      bg: `--ui-tone-${tone}-bg` as TokenName,
      min: 4.5 as const,
    },
    {
      fg: `--ui-tone-${tone}-emphasis-fg` as TokenName,
      bg: `--ui-tone-${tone}-emphasis` as TokenName,
      min: 4.5 as const,
    },
  ]),
  ...ACCENT_PAIRS,
  ...(["--ui-shell-nav-bg", "--ui-shell-main-bg"] as const).flatMap((bg) =>
    (["--ui-fg", "--ui-fg-muted"] as const).map((fg) => ({ fg, bg, min: 4.5 as const })),
  ),
];

/**
 * What a background token is painted over: the page over the UA canvas, surfaces over the page,
 * fills (an accent, a tint, the switch's track) over a surface, the shell's field over the UA
 * canvas and its columns over the field.
 */
function layerBelow(bg: TokenName): TokenName | "base" | "worst" {
  if (bg === "--ui-canvas" || bg === "--ui-shell-field") return "base";
  if (bg === "--ui-glass-bg") return "worst";
  if ((PAGE_SURFACES as readonly string[]).includes(bg) || bg === "--ui-overlay")
    return "--ui-canvas";
  if (bg === "--ui-shell-nav-bg" || bg === "--ui-shell-main-bg") return "--ui-shell-field";
  return "--ui-surface";
}

type Resolve = (name: TokenName) => Rgba | string;

/** The opaque colour a background token shows, composited down its layers; a string is an error. */
function opaqueBackground(bg: TokenName, mode: ThemeModeName, resolve: Resolve): Rgba | string {
  const color = resolve(bg);
  if (typeof color === "string") return color;
  const below = layerBelow(bg);
  // The page sits on the UA canvas; a frosted layer is measured over the worst content it can
  // float over — the opposite extreme.
  const under =
    below === "base"
      ? mode === "light"
        ? WHITE
        : BLACK
      : below === "worst"
        ? mode === "light"
          ? BLACK
          : WHITE
        : opaqueBackground(below, mode, resolve);
  if (typeof under === "string") return under;
  return composite(color, under);
}

function measure(
  pair: Pair,
  mode: ThemeModeName,
  resolve: Resolve,
): { ratio: number; detail: string } | string {
  const fg = resolve(pair.fg);
  if (typeof fg === "string") return fg;
  const bg = opaqueBackground(pair.bg, mode, resolve);
  if (typeof bg === "string") return bg;
  const ratio = contrastRatio(fg, bg);
  return { ratio, detail: `${formatColor(composite(fg, bg))} on ${formatColor(bg)}` };
}

function themeAnalysis(id: ThemeId): ThemeFileAnalysis | null {
  const path = join(SRC_DIR, "themes", `${id}.css`);
  if (!existsSync(path)) return null;
  const analysis = analyzeThemeFile(readFileSync(path, "utf8"), id);
  return analysis.isStub ? null : analysis;
}

const defaultTheme = themeAnalysis(DEFAULT_THEME_ID) ?? analyzeThemeFile("", DEFAULT_THEME_ID);

/** The series colours and the reference line: the marks a chart draws on the page. */
const SERIES_TOKENS = [
  "--ui-chart-1",
  "--ui-chart-2",
  "--ui-chart-3",
  "--ui-chart-4",
  "--ui-chart-5",
  "--ui-chart-6",
  "--ui-chart-7",
  "--ui-chart-8",
  "--ui-chart-ref",
] as const;

/**
 * Whether a series reads on the canvas: a bar, a line or a point must clear WCAG's 3:1 for a
 * graphical object. A theme may draw its bars pale (`--ui-chart-bar-opacity` under 1) so long
 * as the full series colour still clears the floor — the bar's outline (`--ui-chart-bar-stroke`
 * of at least 1px, in the series colour or a colour of the theme's) and every line and point
 * carry it at full strength, so a mark's edge reads even where its fill is soft. So a series
 * passes when its colour clears 3:1, or when its outline is at least 1px wide and does. The
 * result names the ratios so a failure says which of the two fell short.
 */
function seriesReads(
  token: (typeof SERIES_TOKENS)[number],
  mode: ThemeModeName,
  theme: ThemeFileAnalysis,
): { ok: boolean; detail: string } {
  const resolve: Resolve = (name) => {
    const value = resolveThemeValue(name, mode, theme, defaultTheme);
    if (value === null) return `${name} does not resolve to a value`;
    return parseColor(value) ?? `${name} = \`${value}\` is not a colour this suite can read`;
  };
  const series = resolve(token);
  const canvas = opaqueBackground("--ui-canvas", mode, resolve);
  if (typeof series === "string") return { ok: false, detail: series };
  if (typeof canvas === "string") return { ok: false, detail: canvas };
  const direct = contrastRatio(series, canvas);
  const strokeWidth = Number.parseFloat(
    resolveThemeValue("--ui-chart-bar-stroke", mode, theme, defaultTheme) ?? "0",
  );
  const strokeSpec = resolveThemeValue("--ui-chart-bar-stroke-color", mode, theme, defaultTheme);
  const outlineColor =
    strokeSpec === null || strokeSpec.trim() === "series" ? series : parseColor(strokeSpec);
  const outline =
    strokeWidth >= 1 && outlineColor !== null ? contrastRatio(outlineColor, canvas) : null;
  const colors = `${formatColor(series)} on ${formatColor(canvas)}`;
  const edge = outline === null ? "no outline" : `outline ${outline.toFixed(2)}:1`;
  return {
    ok: direct >= 3 || (outline !== null && outline >= 3),
    detail: `${token}: ${direct.toFixed(2)}:1 on the canvas (${colors}), ${edge}`,
  };
}

describe("theme contrast", () => {
  for (const id of THEME_IDS) {
    const theme = themeAnalysis(id);
    if (theme === null) {
      it.skip(`src/themes/${id}.css — PENDING, contrast not checked: no tokens declared yet`, () => {});
      continue;
    }
    for (const mode of THEME_MODES) {
      const resolve: Resolve = (name) => {
        const value = resolveThemeValue(name, mode, theme, defaultTheme);
        if (value === null) return `${name} does not resolve to a value`;
        return parseColor(value) ?? `${name} = \`${value}\` is not a colour this suite can read`;
      };
      const excepted = (pair: Pair) =>
        EXCEPTIONS.find(
          (e) => e.theme === id && e.mode === mode && e.fg === pair.fg && e.bg === pair.bg,
        );

      it(`${id} ${mode}: every listed pair clears its floor`, () => {
        const failures: string[] = [];
        for (const pair of pairsFor(mode)) {
          const result = measure(pair, mode, resolve);
          const name = `${pair.fg} on ${pair.bg}`;
          if (typeof result === "string") failures.push(`${name}: ${result}`);
          else if (result.ratio < pair.min && excepted(pair) === undefined) {
            failures.push(
              `${name}: ${result.ratio.toFixed(2)}:1 < ${pair.min}:1 (${result.detail})`,
            );
          }
        }
        // Joined into the message: vitest elides long arrays in a diff, and the list is the finding.
        expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
      });

      it(`${id} ${mode}: carries no exception that has started passing`, () => {
        const stale = EXCEPTIONS.filter((e) => e.theme === id && e.mode === mode).filter((e) => {
          const pair = pairsFor(mode).find((p) => p.fg === e.fg && p.bg === e.bg);
          if (pair === undefined) {
            // A series exception is stale once the series reads, itself or by its outline.
            const series = SERIES_TOKENS.find((token) => token === e.fg);
            return series === undefined || e.bg !== "--ui-canvas"
              ? true
              : seriesReads(series, mode, theme).ok;
          }
          const result = measure(pair, mode, resolve);
          return typeof result !== "string" && result.ratio >= pair.min;
        });
        const names = stale.map((e) => `${e.fg} on ${e.bg} (${e.until})`);
        expect(names, `remove from EXCEPTIONS:\n${names.join("\n")}\n`).toEqual([]);
      });
    }
  }
});

/**
 * Whether the switch's knob reads on its off track: the knob itself at 3:1, or — where a theme
 * keeps a knob that does not (Primer's white knob on gray-200, today's look) — its hairline edge,
 * `--ui-switch-knob-line` composited over the track, at 3:1. A transparent edge is no edge.
 */
function knobReads(mode: ThemeModeName, theme: ThemeFileAnalysis): { ok: boolean; detail: string } {
  const resolve: Resolve = (name) => {
    const value = resolveThemeValue(name, mode, theme, defaultTheme);
    if (value === null) return `${name} does not resolve to a value`;
    return parseColor(value) ?? `${name} = \`${value}\` is not a colour this suite can read`;
  };
  const track = opaqueBackground("--ui-switch-track", mode, resolve);
  const knob = resolve("--ui-switch-knob");
  const line = resolve("--ui-switch-knob-line");
  if (typeof track === "string") return { ok: false, detail: track };
  if (typeof knob === "string") return { ok: false, detail: knob };
  if (typeof line === "string") return { ok: false, detail: line };
  const direct = contrastRatio(composite(knob, track), track);
  const edge = line.a === 0 ? null : contrastRatio(composite(line, track), track);
  const colors = `${formatColor(composite(knob, track))} on ${formatColor(track)}`;
  const edgeNote = edge === null ? "no edge" : `edge ${edge.toFixed(2)}:1`;
  return {
    ok: direct >= 3 || (edge !== null && edge >= 3),
    detail: `knob ${direct.toFixed(2)}:1 on the off track (${colors}), ${edgeNote}`,
  };
}

describe("the switch's knob on its off track", () => {
  for (const id of THEME_IDS) {
    const theme = themeAnalysis(id);
    if (theme === null) {
      it.skip(`src/themes/${id}.css — PENDING, switch not checked: no tokens declared yet`, () => {});
      continue;
    }
    for (const mode of THEME_MODES) {
      it(`${id} ${mode}: the knob reads at 3:1, itself or by its edge`, () => {
        const result = knobReads(mode, theme);
        expect(result.ok, result.detail).toBe(true);
      });
    }
  }
});

describe("chart series marks", () => {
  for (const id of THEME_IDS) {
    const theme = themeAnalysis(id);
    if (theme === null) {
      it.skip(`src/themes/${id}.css — PENDING, series not checked: no tokens declared yet`, () => {});
      continue;
    }
    for (const mode of THEME_MODES) {
      it(`${id} ${mode}: every series reads on the canvas, itself or by its bar's outline`, () => {
        const failures = SERIES_TOKENS.flatMap((token) => {
          const result = seriesReads(token, mode, theme);
          const excepted = EXCEPTIONS.some(
            (e) => e.theme === id && e.mode === mode && e.fg === token && e.bg === "--ui-canvas",
          );
          return result.ok || excepted ? [] : [result.detail];
        });
        expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
      });
    }
  }
});

describe("accent presets, per theme", () => {
  // A preset replaces the accent tokens under its theme, in both modes (a dark rule lifts it
  // where the theme says so), and everything else stays the theme's: so each preset is measured
  // on its own theme's surfaces for that mode, exactly as the theme's own accent is above.
  for (const id of THEME_IDS) {
    const theme = themeAnalysis(id);
    if (theme === null) {
      it.skip(`src/themes/${id}.css — PENDING, presets not checked: no tokens declared yet`, () => {});
      continue;
    }

    it(`${id}: declares a rule for every preset tokens.ts lists for it, and no other`, () => {
      expect([...theme.accents.keys()]).toEqual([...THEME_ACCENT_PRESETS[id]]);
    });

    for (const accent of THEME_ACCENT_PRESETS[id]) {
      for (const mode of THEME_MODES) {
        it(`${id} ${mode} · ${accent}: its label clears 4.5:1 on it, and it clears 3:1 as a mark`, () => {
          const preset: AccentPresetRules | null = theme.accents.get(accent) ?? null;
          expect(preset, `${accent} has no rule`).not.toBeNull();
          const resolve: Resolve = (name) => {
            const value = resolveThemeValue(name, mode, theme, defaultTheme, preset);
            if (value === null) return `${name} does not resolve to a value`;
            return (
              parseColor(value) ?? `${name} = \`${value}\` is not a colour this suite can read`
            );
          };
          const failures: string[] = [];
          for (const pair of ACCENT_PAIRS) {
            const result = measure(pair, mode, resolve);
            if (typeof result === "string") failures.push(`${pair.fg} on ${pair.bg}: ${result}`);
            else if (result.ratio < pair.min) {
              failures.push(
                `${pair.fg} on ${pair.bg}: ${result.ratio.toFixed(2)}:1 < ${pair.min}:1 (${result.detail})`,
              );
            }
          }
          expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
        });
      }
    }
  }
});

describe("the accent's tint under the person's own words", () => {
  // The user bubble and the steering chip sit on `--ui-accent-tint`, the accent mixed into the
  // canvas; on a custom background they take `--ui-accent-muted`, the same wash with the canvas
  // taken away. Measured for the theme's own accent and every preset, on the theme's values for
  // the mode, the way the presets are measured above.
  for (const id of THEME_IDS) {
    const theme = themeAnalysis(id);
    if (theme === null) {
      it.skip(`src/themes/${id}.css — PENDING, the tint not checked: no tokens declared yet`, () => {});
      continue;
    }
    const accents: readonly (string | null)[] = [null, ...THEME_ACCENT_PRESETS[id]];
    for (const mode of THEME_MODES) {
      /** Resolves each accent's tokens; a string names what could not be read. */
      const resolverFor = (accent: string | null): Resolve => {
        const preset = accent === null ? null : (theme.accents.get(accent) ?? null);
        return (name) => {
          const value = resolveThemeValue(name, mode, theme, defaultTheme, preset);
          if (value === null) return `${name} does not resolve to a value`;
          return parseColor(value) ?? `${name} = \`${value}\` is not a colour this suite can read`;
        };
      };
      const label = (accent: string | null) => accent ?? "the theme's own accent";

      it(`${id} ${mode}: body text and the steering label read on every accent's tint, which stands off the canvas`, () => {
        const shortfalls = TINT_SHORTFALLS.filter((s) => s.theme === id && s.mode === mode);
        const floors: ReadonlyArray<readonly [TokenName, number]> = [
          ...TINT_INK_FLOORS[mode],
          ["--ui-canvas", TINT_STANDS_OFF],
        ];
        const failures: string[] = [];
        const needed = new Set<TintShortfall>();
        for (const accent of accents) {
          const resolve = resolverFor(accent);
          const tint = resolve("--ui-accent-tint");
          if (typeof tint === "string") {
            failures.push(`${label(accent)}: ${tint}`);
            continue;
          }
          // A surface text sits on: a translucent tint would take whatever happens to be under it.
          if (tint.a < 1) {
            failures.push(`${label(accent)}: the tint ${formatColor(tint)} is translucent`);
            continue;
          }
          for (const [other, floor] of floors) {
            const color =
              other === "--ui-canvas" ? opaqueBackground(other, mode, resolve) : resolve(other);
            if (typeof color === "string") {
              failures.push(`${label(accent)}: ${color}`);
              continue;
            }
            const ratio = contrastRatio(color, tint);
            if (ratio >= floor) continue;
            const shortfall = shortfalls.find((s) => s.pair === other);
            if (shortfall !== undefined) needed.add(shortfall);
            const held = shortfall?.holds ?? floor;
            if (ratio < held) {
              failures.push(
                `${label(accent)}: ${other} and the tint ${ratio.toFixed(2)}:1 < ${held}:1 (${formatColor(composite(color, tint))} / ${formatColor(tint)})`,
              );
            }
          }
        }
        const stale = shortfalls
          .filter((s) => !needed.has(s))
          .map((s) => `${s.pair}: no accent needs it any more — remove it from TINT_SHORTFALLS`);
        expect([...failures, ...stale], `\n${[...failures, ...stale].join("\n")}\n`).toEqual([]);
      });

      it(`${id} ${mode}: every accent's wash laid on the page colour is its tint`, () => {
        const failures: string[] = [];
        for (const accent of accents) {
          const resolve = resolverFor(accent);
          const wash = resolve("--ui-accent-muted");
          const tint = resolve("--ui-accent-tint");
          const canvas = opaqueBackground("--ui-canvas", mode, resolve);
          if (typeof wash === "string" || typeof tint === "string" || typeof canvas === "string") {
            failures.push(
              `${label(accent)}: ${[wash, tint, canvas].find((c) => typeof c === "string")}`,
            );
            continue;
          }
          const laid = composite(wash, canvas);
          const apart = Math.max(
            Math.abs(laid.r - tint.r),
            Math.abs(laid.g - tint.g),
            Math.abs(laid.b - tint.b),
            Math.abs(laid.a - tint.a) * 255,
          );
          if (apart > 1) {
            failures.push(
              `${label(accent)}: the wash on the canvas is ${formatColor(laid)}, the tint ${formatColor(tint)}`,
            );
          }
        }
        expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
      });
    }
  }
});
