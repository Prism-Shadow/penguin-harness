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
 * - a tone's ink on its own tint (`tone-*-bg`, a badge) and a solid badge's label on its fill — 4.5:1;
 * - the accent's label on the accent at rest and on hover (the primary button) — 4.5:1 — and the
 *   accent as a mark on the page and the card (a selected row's `>`, a link-coloured glyph) —
 *   3:1; both for the theme's own accent and, in the second suite, for every preset the theme
 *   lists, overlaid on the theme's values for that mode (a dark lift included);
 * - text and muted text on the shell's two columns, composited onto the field behind the window
 *   (Frost's navigation column is transparent on the field) — 4.5:1. The field's two washes are
 *   gradients this suite cannot read; a theme keeps them faint enough that the muted ink still
 *   clears 4.5:1 where they are strongest (Frost's values were measured by hand at 4.56:1).
 *
 * `fg-subtle` has no floor: it is placeholder and disabled ink, which WCAG exempts.
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
import { SRC_DIR } from "./helpers/paths";

interface Pair {
  readonly fg: TokenName;
  readonly bg: TokenName;
  readonly min: 3 | 4.5;
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

/** Known shortfalls. Empty is the goal; every entry names its fix. */
const EXCEPTIONS: readonly ContrastException[] = [];

const PAGE_SURFACES = ["--ui-canvas", "--ui-surface", "--ui-surface-muted", "--ui-inset"] as const;

/** What an accent must clear, the theme's own or a preset's: its label on it, and it as a mark. */
const ACCENT_PAIRS: readonly Pair[] = [
  { fg: "--ui-accent-fg", bg: "--ui-accent", min: 4.5 },
  { fg: "--ui-accent-fg", bg: "--ui-accent-hover", min: 4.5 },
  { fg: "--ui-accent", bg: "--ui-canvas", min: 3 },
  { fg: "--ui-accent", bg: "--ui-surface", min: 3 },
];

const PAIRS: readonly Pair[] = [
  ...[...PAGE_SURFACES, "--ui-overlay" as const].map((bg) => ({
    fg: "--ui-fg" as const,
    bg,
    min: 4.5 as const,
  })),
  ...(["--ui-canvas", "--ui-surface", "--ui-surface-muted"] as const).map((bg) => ({
    fg: "--ui-fg-muted" as const,
    bg,
    min: 4.5 as const,
  })),
  ...(["--ui-canvas", "--ui-surface"] as const).map((bg) => ({
    fg: "--ui-fg-link" as const,
    bg,
    min: 4.5 as const,
  })),
  ...TONES.filter((tone) => tone !== "neutral").flatMap((tone) =>
    PAGE_SURFACES.map((bg) => ({ fg: `--ui-tone-${tone}-fg` as TokenName, bg, min: 3 as const })),
  ),
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
  ...(["--ui-shell-nav-bg", "--ui-shell-main-bg"] as const).flatMap((bg) => [
    { fg: "--ui-fg" as const, bg, min: 4.5 as const },
    { fg: "--ui-fg-muted" as const, bg, min: 4.5 as const },
  ]),
];

/**
 * What a background token is painted over: the page over the UA canvas, surfaces over the page,
 * fills over a surface, the shell's field over the UA canvas and its columns over the field.
 */
function layerBelow(bg: TokenName): TokenName | "base" {
  if (bg === "--ui-canvas" || bg === "--ui-shell-field") return "base";
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
  const under =
    below === "base" ? (mode === "light" ? WHITE : BLACK) : opaqueBackground(below, mode, resolve);
  return typeof under === "string" ? under : composite(color, under);
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
        for (const pair of PAIRS) {
          const result = measure(pair, mode, resolve);
          if (typeof result === "string") failures.push(`${pair.fg} on ${pair.bg}: ${result}`);
          else if (result.ratio < pair.min && excepted(pair) === undefined) {
            failures.push(
              `${pair.fg} on ${pair.bg}: ${result.ratio.toFixed(2)}:1 < ${pair.min}:1 (${result.detail})`,
            );
          }
        }
        // Joined into the message: vitest elides long arrays in a diff, and the list is the finding.
        expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
      });

      it(`${id} ${mode}: carries no exception that has started passing`, () => {
        const stale = EXCEPTIONS.filter((e) => e.theme === id && e.mode === mode).filter((e) => {
          const pair = PAIRS.find((p) => p.fg === e.fg && p.bg === e.bg);
          if (pair === undefined) return true;
          const result = measure(pair, mode, resolve);
          return typeof result !== "string" && result.ratio >= pair.min;
        });
        const names = stale.map((e) => `${e.fg} on ${e.bg} (${e.until})`);
        expect(names, `remove from EXCEPTIONS:\n${names.join("\n")}\n`).toEqual([]);
      });
    }
  }
});

describe("accent presets, per theme", () => {
  // A preset replaces the six accent tokens under its theme, in both modes (a dark rule lifts it
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
