/**
 * The Agent mascot's colours (src/components/icons/avatars/agent-palette.ts).
 *
 * - Given an Agent's id, its palette slot is the same on every call, and realistic ids spread
 *   over all twelve slots.
 * - Given an Agent whose letter tile had hue h, its mascot's slot is the one whose hue anchor lies
 *   within 15° of h: it keeps the colour family it had.
 * - Given any slot, in either mode, the face reads on the head: the mask keeps ≥ 3:1 on the body,
 *   the eyes ≥ 4.5:1 and the beak ≥ 3:1 on the mask.
 * - Given any slot, in every theme and mode, the head stands off the page — ≥ 3:1 against the
 *   canvas, a card and the muted surface.
 * - Given any two slots, they are not near-duplicates: two Agents side by side can be told apart.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { avatarHue } from "../src/components/icons/avatars/avatar";
import {
  AGENT_ACCENTS,
  AGENT_PALETTE,
  agentSlot,
} from "../src/components/icons/avatars/agent-palette";
import { DEFAULT_THEME_ID, THEME_IDS, THEME_MODES } from "../src/tokens";
import type { ThemeId } from "../src/tokens";
import {
  BLACK,
  WHITE,
  analyzeThemeFile,
  composite,
  contrastRatio,
  parseColor,
  resolveThemeValue,
} from "../src/testing";
import type { Rgba, ThemeFileAnalysis } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

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

describe("the face reads on every slot (WCAG)", () => {
  for (const mode of THEME_MODES) {
    it(`${mode}: mask on the head ≥ 3:1, eyes ≥ 4.5:1 and beak ≥ 3:1 on the mask`, () => {
      const mask = color(AGENT_ACCENTS.mask[mode]);
      const failures: string[] = [];
      const eye = contrastRatio(color(AGENT_ACCENTS.eye[mode]), mask);
      if (eye < 4.5) failures.push(`eyes on the mask: ${eye.toFixed(2)}:1`);
      const beak = contrastRatio(color(AGENT_ACCENTS.beak[mode]), mask);
      if (beak < 3) failures.push(`beak on the mask: ${beak.toFixed(2)}:1`);
      AGENT_PALETTE.forEach((body, slot) => {
        const ratio = contrastRatio(mask, color(body));
        if (ratio < 3) failures.push(`slot ${slot} ${body}: mask ${ratio.toFixed(2)}:1`);
      });
      expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
    });
  }
});

/** The surfaces an avatar sits on directly: the page, a card, a muted panel. */
const SURFACES = ["--ui-canvas", "--ui-surface", "--ui-surface-muted"] as const;

function themeAnalysis(id: ThemeId): ThemeFileAnalysis | null {
  const path = join(SRC_DIR, "themes", `${id}.css`);
  if (!existsSync(path)) return null;
  const analysis = analyzeThemeFile(readFileSync(path, "utf8"), id);
  return analysis.isStub ? null : analysis;
}

describe("the head stands off the page (WCAG non-text 3:1)", () => {
  const defaultTheme = themeAnalysis(DEFAULT_THEME_ID);

  it("reads the default theme", () => {
    expect(defaultTheme).not.toBeNull();
  });

  for (const id of THEME_IDS) {
    const theme = themeAnalysis(id);
    if (theme === null || defaultTheme === null) {
      it.skip(`${id} — PENDING: themes/${id}.css declares no tokens yet`, () => {});
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
        AGENT_PALETTE.forEach((hex, slot) => {
          const body = color(hex);
          for (const surface of surfaces) {
            const page = contrastRatio(body, surface.color);
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
  it("are never near-duplicates of one another", () => {
    const close: string[] = [];
    const labs = AGENT_PALETTE.map((hex) => oklab(color(hex)));
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const [a, b] = [labs[i]!, labs[j]!];
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (distance < 0.08) close.push(`slots ${i} and ${j}: ${distance.toFixed(3)}`);
      }
    }
    expect(close, `\n${close.join("\n")}\n`).toEqual([]);
  });
});
