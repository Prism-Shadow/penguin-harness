/**
 * The semantic status tones (src/lib/tone.ts) and the call sites that must not spell a status
 * colour themselves. What these assert is the *single spelling* rule: one meaning, one pair of
 * classes, written in one module — the drift these replaced was amber appearing as `amber-600`
 * in one file and `amber-500` in the next for the same "waiting" state.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toneDot, toneInk, toneStrip, toneSurface } from "../src/lib/tone";
import type { Tone } from "../src/lib/tone";

const TONES: Tone[] = ["busy", "attention", "success", "link", "danger", "muted"];

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), "utf8");

describe("tone tokens", () => {
  it("covers every tone in every map", () => {
    for (const map of [toneInk, toneSurface, toneDot, toneStrip]) {
      for (const tone of TONES) expect(map[tone]).toBeTruthy();
      expect(Object.keys(map).sort()).toEqual([...TONES].sort());
    }
  });

  it("gives each ink a light and a dark class", () => {
    for (const tone of TONES) {
      const classes = toneInk[tone].split(" ");
      expect(classes.filter((c) => c.startsWith("text-"))).toHaveLength(1);
      expect(classes.filter((c) => c.startsWith("dark:text-"))).toHaveLength(1);
    }
  });

  it("keeps busy and success on one ink, and every other pair distinct", () => {
    // Busy and success share a hue because the app has never told them apart by colour; a
    // separate hue would invent a difference nobody is being asked to read.
    expect(toneInk.busy).toBe(toneInk.success);
    expect(new Set([toneInk.attention, toneInk.danger, toneInk.muted, toneInk.busy]).size).toBe(4);
  });

  it("fills a state dot with one value across both themes", () => {
    // A 6px dot has no interior to read: one vivid mid-scale hue works on white and on black,
    // where an ink pair tuned for a stroke does not. Muted is the exception — it must recede.
    for (const tone of ["busy", "attention", "success", "link", "danger"] as const) {
      expect(toneDot[tone]).toMatch(/^bg-[a-z]+-500$/);
    }
  });
});

describe("status marks take their colour from the tokens", () => {
  it("inks the two hourglass states with the same attention tone", () => {
    // The session list's running glyph and the stream's waiting-for-approval glyph are the same
    // state to a reader — unfinished, waiting — so they are the same colour.
    expect(read("components/ui/status-icon.tsx")).toContain("waiting: toneInk.attention");
    expect(read("components/ui/session-activity-icon.tsx")).toContain("toneInk.attention");
  });

  it("leaves no status file spelling a palette class of its own", () => {
    // Categorical palettes (charts, per-skill tints, the terminal's own theme) are deliberately
    // out of scope and are not listed here.
    const files = [
      "components/ui/status-icon.tsx",
      "components/ui/session-activity-icon.tsx",
      "components/ui/badge.tsx",
      "features/chat/step-banner.tsx",
      "features/chat/goal-banner.tsx",
      "features/chat/subagent-chip.tsx",
    ];
    for (const rel of files) {
      const src = read(rel);
      // badge.tsx keeps one deliberate exception, a yellow informational tag that must not read
      // as a warning; it says so at the definition.
      const offenders = [...src.matchAll(/\b(?:text|bg|border)-(?:amber|emerald|red|green)-\d+/g)];
      expect(offenders, `${rel} spells a status colour inline`).toHaveLength(0);
    }
  });
});
