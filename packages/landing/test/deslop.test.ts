/**
 * The landing's sources held to the shared de-slop checks (`packages/ui/src/testing/deslop.ts`)
 * that a marketing page can fail without anyone noticing in a type check or a screenshot diff.
 *
 * - Given every source file and stylesheet under `packages/landing/src`, when each rule below
 *   runs, then it finds nothing: no hover transform (2), no coloured bar down a box's left edge
 *   (8), no literal font size off the scale (13), no uppercase or letter-spaced eyebrow (14), no
 *   emoji in the dictionaries (21), no text below 12px (23), no middle dot between items (24).
 *
 * The other rules hold the app's tokens and motion homes, which the landing does not use: it
 * speaks Tailwind's palette and runs its own entrances, so they are review here, not guard.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DESLOP_RULES, deslopHits } from "../../ui/src/testing/deslop";
import type { DeslopPolicy, DeslopRule } from "../../ui/src/testing/deslop";
import { scanSourceRoots, unscannedRoots } from "../../ui/src/testing/source-roots";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const SCAN = scanSourceRoots({ landing: SRC }, { repoRoot: REPO_ROOT });

/** Only the rules run here read the policy, and none of them reads a home. */
const POLICY: DeslopPolicy = {
  transformMotion: [],
  entranceMotion: [],
  pulseHomes: [],
  spinnerHomes: [],
  tokensOnly: false,
  hexHomes: [],
};

const RULES: readonly DeslopRule[] = [2, 8, 13, 14, 21, 23, 24];

/** Drawn marks whose letters are artwork, sized with the drawing: the AMSP logo's initials. */
const ARTWORK = new Set(["components/amsp-mark.tsx"]);
const FILES = SCAN.files.filter((file) => !ARTWORK.has(file.rel));

describe("de-slop rules over packages/landing/src", () => {
  it("scans the landing's sources, and every artwork file is in them", () => {
    expect(unscannedRoots(SCAN)).toEqual([]);
    expect([...ARTWORK].filter((rel) => !SCAN.files.some((file) => file.rel === rel))).toEqual([]);
  });

  for (const rule of RULES) {
    it(`rule ${rule}: ${DESLOP_RULES[rule]}`, () => {
      expect(
        deslopHits(FILES, rule, POLICY).map((hit) => `${hit.file}:${hit.line}  ${hit.found}`),
      ).toEqual([]);
    });
  }
});
