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
 * - the accent's label on the accent at rest and on hover (the primary button), for the theme's own
 *   accent and every user preset in theme.css — 4.5:1.
 *
 * `fg-subtle` has no floor: it is placeholder and disabled ink, which WCAG exempts.
 *
 * A pair a theme cannot meet yet goes in EXCEPTIONS with the reason and the wave that fixes it; an
 * exception that has started passing fails the suite until it is removed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, DEFAULT_THEME_ID, THEME_IDS, THEME_MODES, TONES } from "../src/tokens";
import type { ThemeId, ThemeModeName, TokenName } from "../src/tokens";
import {
  BLACK,
  WHITE,
  analyzeThemeFile,
  composite,
  contrastRatio,
  formatColor,
  parseColor,
  parseCssRules,
  resolveThemeValue,
  selectorList,
} from "../src/testing";
import type { Rgba, ThemeFileAnalysis } from "../src/testing";
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
  { fg: "--ui-accent-fg", bg: "--ui-accent", min: 4.5 },
  { fg: "--ui-accent-fg", bg: "--ui-accent-hover", min: 4.5 },
];

/** What a background token is painted over: the page over the UA canvas, surfaces over the page, fills over a surface. */
function layerBelow(bg: TokenName): TokenName | "base" {
  if (bg === "--ui-canvas") return "base";
  if ((PAGE_SURFACES as readonly string[]).includes(bg) || bg === "--ui-overlay")
    return "--ui-canvas";
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

const read = (rel: string) => readFileSync(join(SRC_DIR, rel), "utf8");

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

describe("accent presets (theme.css)", () => {
  const presets = new Map<string, Map<string, string>>();
  for (const rule of parseCssRules(read("theme.css"))) {
    if (!rule.atRules.includes("@layer ui-accent")) continue;
    for (const selector of selectorList(rule.selector)) {
      const accent = /^:root\[data-accent="([\w-]+)"\]$/.exec(selector)?.[1];
      if (accent === undefined) continue;
      const values = presets.get(accent) ?? new Map<string, string>();
      for (const d of rule.declarations) values.set(d.name, d.value);
      presets.set(accent, values);
    }
  }

  it("defines a rule for every preset in tokens.ts, and no other", () => {
    expect([...presets.keys()].sort()).toEqual([...ACCENT_PRESETS].sort());
  });

  for (const accent of ACCENT_PRESETS) {
    it(`${accent}: its label clears 4.5:1 on the accent at rest and on hover, in both modes`, () => {
      const values = presets.get(accent) ?? new Map<string, string>();
      const failures: string[] = [];
      for (const bg of ["--ui-accent", "--ui-accent-hover"]) {
        const fg = parseColor(values.get("--ui-accent-fg") ?? "");
        const fill = parseColor(values.get(bg) ?? "");
        if (fg === null || fill === null) {
          failures.push(`--ui-accent-fg on ${bg}: not a readable colour pair`);
          continue;
        }
        // Presets apply in both modes; a translucent fill would show the page through it.
        for (const base of [WHITE, BLACK]) {
          const ratio = contrastRatio(fg, composite(fill, base));
          if (ratio < 4.5) failures.push(`--ui-accent-fg on ${bg}: ${ratio.toFixed(2)}:1`);
        }
      }
      expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
    });
  }
});
