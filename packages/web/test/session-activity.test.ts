import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityIcon, ICON_SIZE } from "@prismshadow/penguin-ui";
import {
  sessionActivity,
  sessionActivityLabel,
  sessionBackgroundTasks,
} from "../src/lib/session-activity";
import type { SessionActivity } from "../src/lib/session-activity";
import { S } from "../src/lib/strings";
import { expectEveryRootScanned, expectSingleHome, scanSources, sourceFile } from "./helpers/roots";

const SCAN = scanSources();
/** The sidebar's conversation row: the package draws the marks, the sidebar hands it their words. */
const SESSION_ROW = "packages/ui/src/components/shell/session-row/session-row.tsx";

describe("the activity marks' sources", () => {
  it("scan every source root, and find the icon module in one place", () => {
    expectEveryRootScanned(SCAN);
    expectSingleHome(SCAN, "packages/ui/src/components/icons/activity-icon/activity-icon.tsx");
  });
});

type Activity = Exclude<SessionActivity, null>;
const ACTIVITIES: readonly Activity[] = ["running", "compacting", "completedUnread"];

describe("sessionActivity", () => {
  it("reports a live run whatever the read state, compaction included", () => {
    expect(sessionActivity("running", true, false)).toBe("running");
    expect(sessionActivity("running", true, true)).toBe("running");
    expect(sessionActivity("compacting", true, false)).toBe("compacting");
    expect(sessionActivity("compacting", true, true)).toBe("compacting");
  });

  it("marks a settled Session only while its last reply is unread", () => {
    expect(sessionActivity("idle", true, true)).toBe("completedUnread");
    // Read: the marker is removed, not muted. Nothing left to act on, nothing shown.
    expect(sessionActivity("idle", true, false)).toBeNull();
  });

  it("shows nothing for a Session that has never run", () => {
    expect(sessionActivity("idle", false, false)).toBeNull();
    // hasTrace is still load-bearing even though read and never-ran look identical: a Session
    // created after this browser first saw the Project has no read marker of its own, so it
    // falls back to the baseline and its creation time reads as UNREAD. Without the guard every
    // brand-new conversation would wear the "go look" dot before it had ever run.
    expect(sessionActivity("idle", false, true)).toBeNull();
  });

  it("still reports a live run started before its Trace was recorded", () => {
    expect(sessionActivity("running", false, false)).toBe("running");
    expect(sessionActivity("compacting", false, false)).toBe("compacting");
  });
});

describe("sessionBackgroundTasks", () => {
  it("is zero without the field and the sum of both counts with it", () => {
    // The server omits the field at zero, so absence is the common case, not an error.
    expect(sessionBackgroundTasks({})).toBe(0);
    expect(sessionBackgroundTasks({ backgroundTasks: { processes: 2, subagents: 0 } })).toBe(2);
    expect(sessionBackgroundTasks({ backgroundTasks: { processes: 1, subagents: 3 } })).toBe(4);
  });

  it("is a facet beside the activity state, not a fourth state", () => {
    // An idle, read Session can still own a dev server: the glyph says nothing and the
    // background count says 1, and the row draws both.
    expect(sessionActivity("idle", true, false)).toBeNull();
    expect(sessionBackgroundTasks({ backgroundTasks: { processes: 1, subagents: 0 } })).toBe(1);
  });
});

/**
 * The glyph carries no text, so the app's words are its only name: each state gets its own, and
 * every place the app draws a mark hands it one. The marks' own drawing is the UI package's
 * (`packages/ui/test/activity-icon.test.ts`); what is checked here is that the app supplies the
 * words and the room the marks need.
 */
describe("the app's words for the activity marks", () => {
  it("labels each state distinctly, in the interface language", () => {
    expect(sessionActivityLabel("running")).toBe(S.chat.statusRunning);
    expect(sessionActivityLabel("compacting")).toBe(S.chat.statusCompacting);
    expect(sessionActivityLabel("completedUnread")).toBe(S.chat.statusCompletedUnread);
    expect(new Set(ACTIVITIES.map(sessionActivityLabel)).size).toBe(ACTIVITIES.length);
  });

  it("names the background count where it stands for a count", () => {
    expect(S.chat.backgroundTasks(3)).toContain("3");
  });

  it("hands every mark its label wherever the app draws one", () => {
    // The sidebar row is the package's SessionRow: the sidebar names each mark, the row draws
    // the mark with the name it was handed.
    const sidebar = sourceFile(SCAN, "packages/web/src/components/layout/sidebar.tsx").text;
    expect(sidebar).toMatch(/\{ state: activity, label: sessionActivityLabel\(activity\) \}/);
    expect(sidebar).toMatch(/scheduledLabel: S\.chat\.sessionScheduled/);
    expect(sidebar).toMatch(/label: S\.chat\.backgroundTasks\(background\)/);
    const row = sourceFile(SCAN, SESSION_ROW).text;
    expect(row).toMatch(/<ActivityIcon activity=\{activity\.state\} label=\{activity\.label\}/);
    expect(row).toMatch(/<ScheduleMark label=\{scheduledLabel\}/);
    expect(row).toMatch(/<BackgroundTasksMark label=\{background\.label\}/);
    const desks = sourceFile(SCAN, "packages/web/src/features/company/org-session-groups.tsx").text;
    expect(desks).toMatch(
      /<ActivityIcon activity=\{activity\} label=\{sessionActivityLabel\(activity\)\}/,
    );
  });

  it("reserves the glyph's box on a row with no glyph, so a row never shifts", () => {
    // Every glyph renders into the same row-mark box, and the sidebar's row reserves that box
    // when there is no glyph at all — otherwise the title would re-flow as a run starts, finishes
    // and is read. The placeholder is read from the row itself so the two cannot drift apart.
    expect(ICON_SIZE.rowMark).toBe(12);
    for (const activity of ACTIVITIES) {
      const markup = renderToStaticMarkup(
        createElement(ActivityIcon, { activity, label: sessionActivityLabel(activity) }),
      );
      expect(markup).toContain("width:12px;height:12px");
    }
    const row = sourceFile(SCAN, SESSION_ROW).text;
    expect(row).toMatch(/activity === null.*\n?.*className="block h-3 w-3 shrink-0"/);
  });
});
