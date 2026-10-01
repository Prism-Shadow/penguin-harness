/**
 * Guard: the status files take their colours from the semantic tones (lib/tone.ts and the UI
 * package's tone tokens) and never spell a status colour themselves — one meaning, one spelling;
 * the drift this replaced was amber appearing as `amber-600` in one file and `amber-500` in the
 * next for the same "waiting" state.
 *
 * - The tone module and each status file live in one place.
 * - No status file spells an amber, emerald, red or green palette class of its own.
 */
import { describe, expect, it } from "vitest";
import { expectEveryRootScanned, expectSingleHome, scanSources, sourceFile } from "./helpers/roots";

const SCAN = scanSources();

/** A source file's text by its repo-relative id; fails when no scanned root holds it. */
const read = (id: string) => sourceFile(SCAN, id).text;

/** The status files that take their colour from the tokens, wherever each one lives. */
const STATUS_FILES = [
  "packages/ui/src/components/icons/status-icon/status-icon.tsx",
  "packages/ui/src/components/icons/activity-icon/activity-icon.tsx",
  "packages/ui/src/components/feedback/badge/badge.tsx",
  "packages/ui/src/components/chat/step-banner/step-banner.tsx",
  "packages/web/src/features/chat/goal-banner.tsx",
  "packages/ui/src/components/chat/subagent-chip/subagent-chip.tsx",
  "packages/web/src/features/chat/subagent-chip.tsx",
  "packages/web/src/features/builtin-browser/browser-layer.tsx",
  "packages/web/src/features/builtin-browser/browser-tab-strip.tsx",
  "packages/web/src/features/builtin-browser/browser-toolbar.tsx",
];

/**
 * Status files that share their name with another root's file by design: a lifted component,
 * drawn by the package and bound to the app by a web container that kept the old path. Each is
 * found by its id instead of by a name no other root holds.
 */
const LIFTED: ReadonlySet<string> = new Set([
  "packages/ui/src/components/chat/subagent-chip/subagent-chip.tsx",
  "packages/web/src/features/chat/subagent-chip.tsx",
]);

describe("tone tokens", () => {
  it("scans every source root, and finds the tone module and each status file in one place", () => {
    expectEveryRootScanned(SCAN);
    for (const id of ["packages/web/src/lib/tone.ts", ...STATUS_FILES]) {
      if (LIFTED.has(id)) sourceFile(SCAN, id);
      else expectSingleHome(SCAN, id);
    }
  });
});

describe("status marks take their colour from the tokens", () => {
  it("leaves no status file spelling a palette class of its own", () => {
    // Categorical palettes (charts, per-skill tints, the terminal's own theme) are deliberately
    // out of scope and are not listed here.
    for (const rel of STATUS_FILES) {
      const src = read(rel);
      const offenders = [...src.matchAll(/\b(?:text|bg|border)-(?:amber|emerald|red|green)-\d+/g)];
      expect(offenders, `${rel} spells a status colour inline`).toHaveLength(0);
    }
  });
});
