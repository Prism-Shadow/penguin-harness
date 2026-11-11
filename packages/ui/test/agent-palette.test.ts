/**
 * The Agent mascot's colours (src/components/icons/avatars/agent-palette.ts).
 *
 * - Given an Agent's id, its palette slot is the same on every call, and realistic ids spread over
 *   all twelve slots.
 * - Given any slot, in either mode, the penguin reads on its tile: its coat keeps ≥ 3:1 on the
 *   tile (a graphic, WCAG non-text contrast), and the eyes, beak and smile keep ≥ 4.5:1 on the face.
 * - Given any slot, in every theme and mode, the penguin stands off the page — its coat keeps
 *   ≥ 3:1 against the canvas, a card and the muted surface, wherever the tile does not.
 * - Given any two slots, in either mode, their coats are not near-duplicates: two Agents side by
 *   side can be told apart.
 */
import { describe, expect, it } from "vitest";
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

describe("an Agent's colour", () => {
  it("is the same for an id every time, and realistic ids reach every slot", () => {
    for (const id of IDS) expect(agentSlot(id)).toBe(agentSlot(id));
    expect(new Set(IDS.map(agentSlot)).size).toBe(AGENT_PALETTE.length);
    for (const id of IDS) {
      expect(agentSlot(id)).toBeGreaterThanOrEqual(0);
      expect(agentSlot(id)).toBeLessThan(AGENT_PALETTE.length);
    }
  });
});

describe("the penguin reads on its tile", () => {
  for (const mode of THEME_MODES) {
    it(`${mode}: every slot's coat keeps ≥ 3:1 on its tile, and its marks ≥ 4.5:1 on its face`, () => {
      const failures: string[] = [];
      AGENT_PALETTE.forEach(({ tile, coat, face, mark }, slot) => {
        const body = contrastRatio(color(coat[mode]), color(tile[mode]));
        if (body < 3) failures.push(`slot ${slot} coat on tile: ${body.toFixed(2)}:1`);
        const marks = contrastRatio(color(mark[mode]), color(face[mode]));
        if (marks < 4.5) failures.push(`slot ${slot} marks on face: ${marks.toFixed(2)}:1`);
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
  const baseTheme = themeAnalysis(INITIAL_THEME_ID);

  it("reads the base theme", () => {
    expect(baseTheme).not.toBeNull();
  });

  for (const id of THEME_IDS) {
    const theme = themeAnalysis(id);
    if (theme === null || baseTheme === null) {
      it.skip(`${id} — PENDING: themes/${id}/ declares no tokens yet`, () => {});
      continue;
    }
    for (const mode of THEME_MODES) {
      it(`${id} ${mode}: every slot's coat against the page surfaces`, () => {
        const failures: string[] = [];
        const ground = mode === "light" ? WHITE : BLACK;
        const surfaces = SURFACES.flatMap((name) => {
          const value = resolveThemeValue(name, mode, theme, baseTheme);
          const parsed = value === null ? null : parseColor(value);
          if (parsed === null) {
            failures.push(`${name} does not resolve to a colour (${String(value)})`);
            return [];
          }
          return [{ name, color: composite(parsed, ground) }];
        });
        AGENT_PALETTE.forEach(({ coat }, slot) => {
          const penguin = color(coat[mode]);
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
    it(`${mode}: are never coated in near-duplicates of one another`, () => {
      const close: string[] = [];
      const labs = AGENT_PALETTE.map(({ coat }) => oklab(color(coat[mode])));
      for (let i = 0; i < labs.length; i++) {
        for (let j = i + 1; j < labs.length; j++) {
          const [a, b] = [labs[i]!, labs[j]!];
          const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          // A mid-tone coat in dark mode holds less chroma than a dark one in light; 0.06 is still
          // a few steps of visible difference (a just-noticeable one is about 0.02).
          if (distance < 0.06) close.push(`slots ${i} and ${j}: ${distance.toFixed(3)}`);
        }
      }
      expect(close, `\n${close.join("\n")}\n`).toEqual([]);
    });
  }
});
