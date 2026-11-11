/**
 * The Agent mascot's colours (src/components/icons/avatars/agent-palette.ts).
 *
 * - Given an Agent's id, its palette slot is the same on every call, and realistic ids spread
 *   over all twelve slots.
 * - Given an Agent whose letter tile had hue h, its mascot's slot is the one whose hue anchor lies
 *   within 15° of h: it keeps the colour family it had.
 * - Given any slot, in either mode, the penguin reads on its tile: the ink keeps ≥ 4.5:1 (AA).
 * - Given any slot, in every theme and mode, the penguin stands off the page — its ink keeps
 *   ≥ 3:1 against the canvas, a card and the muted surface, wherever the pale tile does not.
 * - Given any two slots, in either mode, their inks are not near-duplicates: two Agents side by
 *   side can be told apart.
 */

import { describe, expect, it } from "vitest";
import { avatarHue } from "../src/components/icons/avatars/avatar";
import { AGENT_PALETTE, agentSlot } from "../src/components/icons/avatars/agent-palette";
import { INITIAL_THEME_ID, THEME_IDS, THEME_MODES } from "../src/tokens";
import type { ThemeId } from "../src/tokens";
import {
  BLACK,
  WHITE,
  analyzePack,
  composite,
  contrastRatio,
  parseColor,
  resolveThemeValue,
} from "../src/testing";
import type { Rgba, ThemeFileAnalysis } from "../src/testing";

const color = (value: string): Rgba => {
  const parsed = parseColor(value);
  if (parsed === null) throw new Error(`not a colour: ${value}`);
  return parsed;
};

/** Ids an Agent is given: the samples' names and a few hundred numbered ones. */
const IDS = [
  "default",
  "docs-expert",
  "release-notes",
  "qa",
  "acme_ceo",
  "深度求索",
  ...Array.from({ length: 300 }, (_, n) => `agent-${n}`),
];

describe("agentSlot", () => {
  it("gives an id the same slot every time, and realistic ids reach every slot", () => {
    for (const id of IDS) expect(agentSlot(id)).toBe(agentSlot(id));
    expect(new Set(IDS.map(agentSlot)).size).toBe(AGENT_PALETTE.length);
    for (const id of IDS) {
      expect(agentSlot(id)).toBeGreaterThanOrEqual(0);
      expect(agentSlot(id)).toBeLessThan(AGENT_PALETTE.length);
    }
  });

  it("keeps an Agent in the colour family its letter tile had", () => {
    const far = IDS.filter((id) => {
      const anchor = agentSlot(id) * 30;
      const off = Math.abs(avatarHue(id) - anchor);
      return Math.min(off, 360 - off) > 15;
    });
    expect(far).toEqual([]);
  });
});

describe("the penguin reads on its tile (WCAG AA)", () => {
  for (const mode of THEME_MODES) {
    it(`${mode}: every slot's ink keeps ≥ 4.5:1 on its tile`, () => {
      const failures: string[] = [];
      AGENT_PALETTE.forEach(({ tile, ink }, slot) => {
        const ratio = contrastRatio(color(ink[mode]), color(tile[mode]));
        if (ratio < 4.5) {
          failures.push(`slot ${slot} ${ink[mode]} on ${tile[mode]}: ${ratio.toFixed(2)}:1`);
        }
      });
      expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
    });
  }
});

/** The surfaces an avatar sits on directly: the page, a card, a muted panel. */
const SURFACES = ["--ui-canvas", "--ui-surface", "--ui-surface-muted"] as const;

function themeAnalysis(id: ThemeId): ThemeFileAnalysis | null {
  const analysis = analyzePack(id);
  return analysis.isStub ? null : analysis;
}

describe("the penguin stands off the page (WCAG non-text 3:1)", () => {
  const defaultTheme = themeAnalysis(INITIAL_THEME_ID);

  it("reads the default theme", () => {
    expect(defaultTheme).not.toBeNull();
  });

  for (const id of THEME_IDS) {
    const theme = themeAnalysis(id);
    if (theme === null || defaultTheme === null) {
      it.skip(`${id} — PENDING: themes/${id}/ declares no tokens yet`, () => {});
      continue;
    }
    for (const mode of THEME_MODES) {
      it(`${id} ${mode}: every slot against the page surfaces`, () => {
        const failures: string[] = [];
        const ground = mode === "light" ? WHITE : BLACK;
        const surfaces = SURFACES.flatMap((name) => {
          const value = resolveThemeValue(name, mode, theme, defaultTheme);
          const parsed = value === null ? null : parseColor(value);
          if (parsed === null) {
            failures.push(`${name} does not resolve to a colour (${String(value)})`);
            return [];
          }
          return [{ name, color: composite(parsed, ground) }];
        });
        AGENT_PALETTE.forEach(({ ink }, slot) => {
          const penguin = color(ink[mode]);
          for (const surface of surfaces) {
            const page = contrastRatio(penguin, surface.color);
            if (page < 3) failures.push(`slot ${slot} on ${surface.name}: ${page.toFixed(2)}:1`);
          }
        });
        expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
      });
    }
  }
});

/** An sRGB colour in OKLab, the space where a distance is roughly how different two look. */
function oklab({ r, g, b }: Rgba): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

describe("the palette's slots", () => {
  for (const mode of THEME_MODES) {
    it(`${mode}: are never inked near-duplicates of one another`, () => {
      const close: string[] = [];
      const labs = AGENT_PALETTE.map(({ ink }) => oklab(color(ink[mode])));
      for (let i = 0; i < labs.length; i++) {
        for (let j = i + 1; j < labs.length; j++) {
          const [a, b] = [labs[i]!, labs[j]!];
          const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          // A pastel ink in dark mode holds less chroma than a dark one in light; 0.075 is still
          // several steps of visible difference (a just-noticeable one is about 0.02).
          if (distance < 0.075) close.push(`slots ${i} and ${j}: ${distance.toFixed(3)}`);
        }
      }
      expect(close, `\n${close.join("\n")}\n`).toEqual([]);
    });
  }
});
