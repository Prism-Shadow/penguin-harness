/**
 * The de-slop rules (K-redesign §3) over `packages/web/src`.
 *
 * The same checks the package holds itself to (`packages/ui/src/testing/deslop.ts`, run over
 * `packages/ui/src` by `packages/ui/test/deslop.test.ts`), run over the web app, where the tells
 * K-redesign §1.5 counts still stand: `transition-all`, a hover scale, pings and pulses on things
 * that are not live, thirteen hand-drawn spinners, one-hue notice boxes, 10–11 px text, uppercase
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
 * each wave moves it to tokens. Rule 22 waits for a `PageHeader` (W4).
 */
import { describe, expect, it } from "vitest";
import {
  DESLOP_RULE_NUMBERS,
  DESLOP_RULES,
  PAGE_HEADER_COMPONENTS,
  allowlistProblems,
  analyzeFile,
  deslopHits,
  matchesPolicyPath,
} from "../../ui/src/testing/deslop";
import type { DeslopAllowlist, DeslopPolicy } from "../../ui/src/testing/deslop";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";

const SCAN = scanSources();
const WEB = SCAN.files.filter((file) => file.root === "web");

/** The homes §3 names, as the web app spells them today. It has no Spinner of its own: W1 adds it. */
const POLICY: DeslopPolicy = {
  transformMotion: ["chevron.tsx", "sheet.tsx", "drawer.tsx", "dock-launcher.tsx"],
  entranceMotion: [],
  // The app's one pulse home: `Dot` and `StreamingCaret` are W1's, in the package, where
  // `packages/ui/test/deslop.test.ts` already names them.
  pulseHomes: ["skeleton.tsx"],
  spinnerHomes: [],
  tokensOnly: false,
  hexHomes: [],
};

/**
 * What the web app still holds, seeded from K-redesign §1.5, by path under `packages/web/src`:
 * `{ rule: [count, wave] }`. The wave is the one whose PR rewrites those lines — where §1.5 names
 * it (`transition-all`, spinners, pings → W1b; the hover scale → W2's SwatchPicker; one-hue boxes →
 * W4's Notice), that wave; otherwise the wave that moves or rebuilds the file (A-architecture §7:
 * W1 marks and actions, W2 forms, W3 overlays, W4 layout, navigation, notices and data display, W5
 * content, W6 chat, W7 files, shell and dock, W8 charts). `W1b+W7` splits an entry between two.
 */
const ALLOWLIST: DeslopAllowlist = {
  "components/account/update-modal.tsx": {
    1: [1, "W4"],
    3: [1, "W4"],
    6: [1, "W4"],
    11: [2, "W1b"],
  },
  "components/account/update-row.tsx": { 11: [2, "W1b"] },
  "components/layout/app-layout.tsx": { 1: [1, "W7"] },
  "components/layout/project-dialogs.tsx": { 13: [1, "W3"] },
  "components/layout/sidebar.tsx": {
    1: [5, "W1b+W7"],
    12: [5, "W7"],
    13: [3, "W7"],
    14: [2, "W7"],
  },
  "components/ui/badge.tsx": { 13: [1, "W1"] },
  "components/ui/confirm-modal.tsx": { 7: [1, "W3"] },
  "components/ui/copy-button.tsx": { 12: [2, "W1"] },
  "components/ui/group-list.tsx": { 12: [1, "W4"], 13: [3, "W4"], 14: [2, "W4"] },
  "components/ui/input.tsx": { 9: [1, "W2"] },
  "components/ui/option-menu.tsx": { 13: [1, "W2"] },
  "components/ui/paged-dialog.tsx": { 13: [1, "W3"], 14: [2, "W3"] },
  "components/ui/segmented.tsx": { 12: [2, "W2"] },
  "components/ui/session-row-menu.tsx": { 1: [1, "W1b"] },
  "components/ui/sheet.tsx": { 19: [1, "W3"] },
  "components/ui/status-icon.tsx": { 11: [2, "W1b"] },
  "components/ui/switch.tsx": { 1: [1, "W2"] },
  "components/ui/toast.tsx": { 9: [4, "W4"] },
  "components/ui/update-dot.tsx": { 13: [1, "W1"] },
  "features/agents/agent-settings-page.tsx": { 12: [3, "W4"] },
  "features/agents/hooks-tab.tsx": { 12: [1, "W4"], 13: [2, "W4"] },
  "features/agents/mcp-servers-section.tsx": { 13: [3, "W4"] },
  "features/agents/memory-tab.tsx": { 1: [1, "W4"], 4: [1, "W4"], 12: [8, "W4"], 13: [5, "W4"] },
  "features/agents/prompt-injection-controls.tsx": { 4: [1, "W4"], 12: [2, "W4"] },
  "features/agents/schedules-tab.tsx": { 12: [1, "W4"] },
  "features/agents/skills-tab.tsx": { 12: [1, "W4"], 13: [2, "W4"] },
  "features/ai-create/ai-create-panel.tsx": { 13: [1, "W4"] },
  "features/benchmark/benchmark-case-browser.tsx": { 13: [2, "W4"] },
  "features/benchmark/benchmark-detail.tsx": { 13: [2, "W4"] },
  "features/benchmark/benchmark-page.tsx": { 13: [2, "W4"], 18: [1, "W4"] },
  "features/benchmark/create-benchmark-modal.tsx": { 13: [1, "W3"] },
  "features/benchmark/evaluation-detail-modal.tsx": { 13: [2, "W3"] },
  "features/chat/agent-topology-view.tsx": { 12: [1, "W6"], 13: [3, "W6"] },
  "features/chat/chat-input.tsx": { 7: [1, "W6"], 12: [6, "W6"], 13: [5, "W6"] },
  "features/chat/chat-page.tsx": { 6: [1, "W1b"], 12: [2, "W6"], 13: [3, "W6"], 15: [1, "W4"] },
  "features/chat/code-block.tsx": { 13: [1, "W5"] },
  "features/chat/context-gauge.tsx": { 12: [5, "W8"] },
  "features/chat/conversation-outline.tsx": { 1: [1, "W1b"], 6: [2, "W1b"], 12: [1, "W6"] },
  "features/chat/disclosure-row.tsx": { 13: [1, "W4"], 14: [2, "W4"] },
  "features/chat/draft-view.tsx": { 12: [1, "W6"], 13: [2, "W6"] },
  "features/chat/drop-zone.tsx": { 18: [1, "W7"] },
  "features/chat/live-duration.tsx": { 6: [1, "W4"] },
  "features/chat/memory-view.tsx": { 13: [2, "W6"] },
  "features/chat/message-item.tsx": { 4: [2, "W6"], 6: [1, "W6"], 13: [3, "W6"] },
  "features/chat/message-stream.tsx": { 11: [2, "W1b"] },
  "features/chat/reference-chip.tsx": { 12: [1, "W6"] },
  "features/chat/shortcuts-folder.tsx": { 12: [1, "W7"] },
  "features/chat/step-banner.tsx": { 13: [1, "W6"], 14: [2, "W6"] },
  "features/chat/subagent-chip.tsx": { 11: [2, "W1b"], 13: [1, "W6"] },
  "features/chat/subagents-view.tsx": { 13: [2, "W6"], 14: [2, "W6"] },
  "features/chat/task-stats-line.tsx": { 6: [1, "W1b"], 13: [1, "W6"], 15: [1, "W4"] },
  "features/chat/tool-call-card.tsx": { 6: [2, "W6"] },
  "features/chat/work-group.tsx": { 13: [1, "W6"] },
  "features/chat/workspace-browser.tsx": {
    1: [1, "W7"],
    11: [4, "W1b"],
    12: [4, "W7"],
    13: [1, "W7"],
    18: [1, "W7"],
  },
  "features/chat/workspace-tree-view.tsx": { 13: [1, "W7"] },
  "features/company/beta-badge.tsx": { 13: [1, "W4"] },
  "features/company/calendar-page.tsx": { 12: [3, "W4"], 13: [10, "W4"] },
  "features/company/channel-composer.tsx": { 13: [2, "W6"] },
  "features/company/channel-header.tsx": { 13: [4, "W6"] },
  "features/company/channel-sidebar.tsx": { 12: [2, "W4"], 13: [6, "W4"], 14: [2, "W4"] },
  "features/company/channel-view.tsx": { 12: [1, "W6"], 13: [6, "W6"] },
  "features/company/chart-card.tsx": { 6: [1, "W1b"], 12: [1, "W8"], 13: [5, "W8"] },
  "features/company/employee-dialogs.tsx": { 12: [1, "W4"] },
  "features/company/finance-gauge.tsx": { 13: [1, "W8"] },
  "features/company/finance-page.tsx": { 12: [3, "W4"], 13: [6, "W4"] },
  "features/company/handbook-explorer.tsx": { 13: [1, "W4"] },
  "features/company/handbook-page.tsx": { 12: [2, "W4"], 13: [3, "W4"] },
  "features/company/org-chart-page.tsx": { 13: [2, "W4"] },
  "features/company/org-dialogs.tsx": { 13: [1, "W4"] },
  "features/company/org-layout.tsx": { 12: [1, "W4"], 13: [2, "W4"], 14: [2, "W4"] },
  "features/company/org-session-groups.tsx": { 12: [1, "W4"] },
  "features/company/org-switcher.tsx": { 13: [3, "W4"], 14: [2, "W4"] },
  "features/company/overview-page.tsx": { 12: [2, "W4"], 13: [2, "W4"], 14: [4, "W4"] },
  "features/company/shared.tsx": { 13: [3, "W4"] },
  "features/company/ticket-dialog.tsx": { 12: [6, "W4"], 13: [3, "W4"], 14: [2, "W4"] },
  "features/company/tickets-page.tsx": { 12: [4, "W4"], 13: [6, "W4"] },
  "features/dock/dock-drag.tsx": { 3: [1, "W7"], 12: [1, "W7"] },
  "features/dock/dock-launcher.tsx": { 13: [1, "W7"], 18: [3, "W7"], 19: [4, "W7"] },
  "features/dock/dock-panel.tsx": { 1: [2, "W7"], 12: [2, "W7"], 13: [1, "W7"] },
  "features/models/models-page.tsx": { 1: [1, "W4"], 11: [8, "W1b"], 12: [7, "W4"], 13: [8, "W4"] },
  "features/models/platform-key-auth-dialog.tsx": { 11: [2, "W1b"] },
  "features/models/protocol-suffix.tsx": { 11: [2, "W1b"] },
  "features/plugins/plugin-detail-page.tsx": { 13: [2, "W4"] },
  "features/plugins/plugin-detail.tsx": { 13: [1, "W4"] },
  "features/plugins/plugins-page.tsx": {
    1: [1, "W4"],
    12: [6, "W4"],
    13: [11, "W4"],
    14: [2, "W4"],
  },
  "features/schedules/schedule-form-modal.tsx": { 13: [2, "W2"] },
  "features/schedules/schedule-panel.tsx": { 12: [1, "W4"] },
  "features/schedules/schedule-suggestions.tsx": { 12: [1, "W4"], 13: [1, "W4"] },
  "features/semantic-id/semantic-id-field.tsx": { 11: [2, "W1b"] },
  "features/settings/proxy-section.tsx": { 13: [1, "W2"] },
  "features/settings/setting-row.tsx": { 1: [1, "W2"], 2: [1, "W2"] },
  "features/skills/skill-pick-list.tsx": { 12: [1, "W2"] },
  "features/traces/timeline-chart.tsx": { 6: [2, "W8"], 13: [10, "W8"] },
  "features/traces/trace-event-row.tsx": { 12: [2, "W4"], 13: [1, "W4"] },
  "features/traces/trace-file-view.tsx": { 12: [2, "W4"], 13: [5, "W4"], 15: [1, "W4"] },
  "features/usage/usage-charts.tsx": { 13: [3, "W8"] },
  "features/usage/usage-page.tsx": { 12: [1, "W8"] },
  "lib/tone.ts": { 9: [4, "W4"] },
  "pages/login.tsx": { 9: [1, "W4"] },
};

const WAVES = /^W(?:1a?|1b|[2-9])(?:\+W(?:1a?|1b|[2-9]))*$/;
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

  it("names a file the web app has in every policy home", () => {
    const homes = [
      ...POLICY.transformMotion,
      ...POLICY.entranceMotion,
      ...POLICY.pulseHomes,
      ...POLICY.spinnerHomes,
      ...POLICY.hexHomes,
    ];
    const missing = homes.filter(
      (home) => !WEB.some((file) => matchesPolicyPath(file.rel, [home])),
    );
    expect(
      missing,
      "A home naming no file is an exemption waiting for one: the first file to take that name " +
        "passes the rule silently, with no allowlist entry and no wave. The package's POLICY is " +
        "forward-looking on purpose; this list is what the app spells today.",
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
      it.skip(`${title} — PENDING: the web app has no PageHeader (W4 adds it to the package)`, () => {});
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
