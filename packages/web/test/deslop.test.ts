/**
 * The de-slop rules (K-redesign §3) over `packages/web/src`.
 *
 * The same checks the package holds itself to (`packages/ui/src/testing/deslop.ts`, run over
 * `packages/ui/src` by `packages/ui/test/deslop.test.ts`), run over the web app, where the tells
 * K-redesign §1.5 counts still stand: size and transform tweens off their homes, a hover scale,
 * pulses on things that are not live, one-hue notice boxes, 10–11 px text, uppercase
 * micro-titles. Each of those is in {@link ALLOWLIST} — per file, per rule, how many and the wave
 * that removes them — and nothing else may appear. The counts are exact both ways: a new hit fails
 * as new slop, and a hit that goes away fails until its entry shrinks, so the list only tightens and
 * every wave's PR shows its share of it leaving.
 *
 * Only the web root is judged here. A file a wave moves into the package leaves its entries behind
 * (they fail as stale) and is judged by the package suite, which allows nothing — which is how a
 * component is de-slopped when it moves, and not after.
 *
 * Rule 20 (palette classes, `dark:`, hex) is the package's: the web app speaks the palette until
 * each wave moves it to tokens. Rule 22 reads a `PageHeader`, and the one the app renders is the
 * package's (W4), whose suite runs the rule; here it runs only if the web app declares its own.
 */
import { describe, expect, it } from "vitest";
import {
  DESLOP_RULE_NUMBERS,
  DESLOP_RULES,
  PAGE_HEADER_COMPONENTS,
  allowlistProblems,
  analyzeFile,
  deslopHits,
} from "../../ui/src/testing/deslop";
import type { DeslopAllowlist, DeslopPolicy } from "../../ui/src/testing/deslop";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";

const SCAN = scanSources();
const WEB = SCAN.files.filter((file) => file.root === "web");

/**
 * The homes §3 names, as the web app spells them today. It has no Spinner of its own (the
 * package's is the one), the chevron's rotation left with the chevron, and the sheet's and the
 * drawer's motion with them (W3).
 */
const POLICY: DeslopPolicy = {
  transformMotion: ["dock-launcher.tsx"],
  entranceMotion: [],
  pulseHomes: ["dot.tsx", "streaming-caret.tsx"],
  spinnerHomes: [],
  tokensOnly: false,
  hexHomes: [],
};

/**
 * What the web app still holds, seeded from K-redesign §1.5, by path under `packages/web/src`:
 * `{ rule: [count, wave] }`. The wave is the one whose PR rewrites those lines — where §1.5 names
 * it (the hover scale → W2's SwatchPicker; one-hue boxes → W4's Notice), that wave; otherwise the
 * wave that moves or rebuilds the file (A-architecture §7: W1 marks and actions, W2 forms, W3
 * overlays, W4 layout, navigation, notices and data display, W5 content, W6 chat, W7 files, shell
 * and dock, W8 charts). `Wn+Wm` splits an entry between two.
 * `W10` is the follow-up sweep of the code that landed on main while the waves were in flight.
 */
const ALLOWLIST: DeslopAllowlist = {
  "components/layout/app-layout.tsx": { 1: [1, "W7"] },
  "components/layout/sidebar.tsx": { 1: [3, "W7"], 12: [5, "W7"], 13: [2, "W7"], 14: [2, "W7"] },
  "features/builtin-browser/browser-tab-strip.tsx": { 12: [2, "W10"] },
  "features/chat/agent-topology-view.tsx": { 12: [1, "W6"], 13: [3, "W6"] },
  "features/chat/chat-input.tsx": { 7: [1, "W6"], 12: [7, "W6"], 13: [5, "W6"] },
  "features/chat/chat-page.tsx": { 12: [2, "W6"], 13: [3, "W6"] },
  "features/chat/conversation-outline.tsx": { 12: [1, "W6"] },
  "features/chat/draft-view.tsx": { 12: [1, "W6"], 13: [1, "W6"] },
  "features/chat/drop-zone.tsx": { 18: [1, "W7"] },
  "features/chat/memory-view.tsx": { 13: [2, "W6"] },
  "features/chat/message-item.tsx": { 4: [2, "W6"], 13: [3, "W6"] },
  "features/chat/model-picker-modal.tsx": { 12: [1, "W10"] },
  "features/chat/shortcuts-folder.tsx": { 12: [1, "W7"] },
  "features/chat/step-banner.tsx": { 13: [1, "W6"], 14: [2, "W6"] },
  "features/chat/subagent-chip.tsx": { 13: [1, "W6"] },
  "features/chat/subagents-view.tsx": { 13: [2, "W6"], 14: [2, "W6"] },
  "features/chat/task-stats-line.tsx": { 13: [1, "W6"] },
  "features/chat/tool-call-card.tsx": { 6: [2, "W6"] },
  "features/chat/work-group.tsx": { 13: [1, "W6"] },
  "features/chat/workspace-browser.tsx": {
    1: [1, "W7"],
    12: [3, "W7"],
    13: [1, "W7"],
    18: [1, "W7"],
  },
  "features/chat/workspace-finder.tsx": { 12: [6, "W10"] },
  "features/chat/workspace-tree-view.tsx": { 13: [1, "W7"] },
  "features/company/channel-composer.tsx": { 13: [2, "W6"] },
  "features/company/channel-header.tsx": { 13: [3, "W6"] },
  "features/company/channel-view.tsx": { 12: [1, "W6"], 13: [6, "W6"] },
  "features/dock/dock-drag.tsx": { 3: [1, "W7"], 12: [1, "W7"] },
  "features/dock/dock-launcher.tsx": { 13: [1, "W7"], 18: [3, "W7"], 19: [4, "W7"] },
  "features/dock/dock-panel.tsx": { 1: [2, "W7"], 12: [2, "W7"] },
  "features/settings/shortcut-recorder.tsx": { 12: [1, "W10"], 13: [1, "W10"] },
  "features/settings/shortcuts-section.tsx": { 13: [1, "W10"] },
  "features/terminal/terminal-appearance.ts": { 9: [1, "W10"] },
  "features/terminal/terminal-keybar.tsx": { 12: [1, "W10"] },
};

const WAVES = /^W(?:1a?|1b|10|[2-9])(?:\+W(?:1a?|1b|10|[2-9]))*$/;
const relOf = (id: string) => id.slice("packages/web/src/".length);

describe("de-slop rules over packages/web/src", () => {
  it("scans every source root, and every allowlisted file is still in the web app", () => {
    expectEveryRootScanned(SCAN);
    const gone = Object.keys(ALLOWLIST).filter((rel) => !WEB.some((file) => file.rel === rel));
    expect(
      gone,
      "An allowlisted file that left packages/web/src moved into the package (whose suite allows " +
        "nothing) or was deleted: remove its entry.",
    ).toEqual([]);
  });

  it("names a planned wave in every entry", () => {
    const unplanned = Object.entries(ALLOWLIST).flatMap(([rel, rules]) =>
      Object.entries(rules).flatMap(([rule, entry]) =>
        entry !== undefined && WAVES.test(entry[1]) && entry[0] > 0 ? [] : [`${rel} rule ${rule}`],
      ),
    );
    expect(unplanned).toEqual([]);
  });

  for (const rule of DESLOP_RULE_NUMBERS) {
    const title = `rule ${rule}: ${DESLOP_RULES[rule]}`;
    if (rule === 20) {
      it.skip(`${title} — not applied to the web app: it moves off the palette wave by wave`, () => {});
      continue;
    }
    if (
      rule === 22 &&
      !WEB.some((file) =>
        analyzeFile(file).components.some((c) => PAGE_HEADER_COMPONENTS.includes(c.name)),
      )
    ) {
      it.skip(`${title} — the PageHeader is the package's, whose suite runs this rule`, () => {});
      continue;
    }
    it(title, () => {
      expect(
        allowlistProblems(deslopHits(WEB, rule, POLICY), rule, ALLOWLIST, (hit) => relOf(hit.file)),
        `K-redesign §3 rule ${rule}: ${DESLOP_RULES[rule]}. Fix a new hit rather than allowlisting ` +
          "it; when a hit goes away, shrink its entry.",
      ).toEqual([]);
    });
  }
});
