/**
 * The activity marks: each live state a shape and a motion of its own in one attention ink, the
 * unread state a success dot centred in the same box, every state named by the caller's label —
 * and the two marks beside them in the busy and the subtle ink. The motion lives in theme.css
 * and must leave the glyph upright and visible when animation is switched off.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  ActivityIcon,
  BackgroundTasksMark,
  ScheduleMark,
} from "../src/components/icons/activity-icon/activity-icon";
import type { ActivityIconState } from "../src/components/icons/activity-icon/activity-icon";
import { ICONS } from "../src/components/icons/icons";
import { ICON_SIZE } from "../src/icon-scale";
import { renderStatic } from "../src/testing";

const ACTIVITIES: readonly ActivityIconState[] = ["running", "compacting", "completedUnread"];
const LABELS: Record<ActivityIconState, string> = {
  running: "Running",
  compacting: "Compacting",
  completedUnread: "Finished, unread",
};

const render = (activity: ActivityIconState) =>
  renderStatic(createElement(ActivityIcon, { activity, label: LABELS[activity] }));

describe("ActivityIcon", () => {
  it("draws a different shape for each live state, from the registry", () => {
    expect(ICONS.compress).not.toBe(ICONS.hourglass);
    expect(render("running")).toContain(`d="${ICONS.hourglass}"`);
    expect(render("compacting")).toContain(`d="${ICONS.compress}"`);
  });

  it("gives each live state its own motion and leaves the dot still", () => {
    expect(render("running")).toContain("hourglass-turn");
    expect(render("compacting")).toContain("compact-squeeze");
    expect(render("compacting")).not.toContain("hourglass-turn");
    const unread = render("completedUnread");
    expect(unread).not.toContain("hourglass-turn");
    expect(unread).not.toContain("compact-squeeze");
    expect(unread).not.toContain("ui-live");
  });

  it("draws the unread state as the success dot, not a glyph", () => {
    const unread = render("completedUnread");
    expect(unread).not.toContain("<svg");
    expect(unread).toContain("width:6px;height:6px");
    // A row that mounts finished (a list loading) brings nothing in: the reveal is for a run
    // the reader watched finish.
    expect(unread).not.toContain("data-reveal");
  });

  it("names every state with the caller's label, live ones as a status", () => {
    for (const activity of ACTIVITIES) {
      const html = render(activity);
      expect(html).toContain(`aria-label="${LABELS[activity]}"`);
      expect(html).toContain(`data-tooltip="${LABELS[activity]}"`);
    }
    expect(render("running")).toContain('role="status"');
    expect(render("compacting")).toContain('role="status"');
    expect(render("completedUnread")).toContain('role="img"');
  });

  it("occupies the same row-mark box whatever the state, unless the caller sizes it", () => {
    for (const activity of ACTIVITIES) {
      expect(render(activity)).toMatch(/^<span[^>]*style="width:12px;height:12px"/);
    }
    const larger = renderStatic(
      createElement(ActivityIcon, { activity: "running", label: "Running", size: 16 }),
    );
    expect(larger).toContain("width:16px;height:16px");
  });
});

describe("BackgroundTasksMark and ScheduleMark", () => {
  it("draw background work named by the caller, at the caller's size", () => {
    const html = renderStatic(
      createElement(BackgroundTasksMark, { label: "3 background tasks", size: ICON_SIZE.rowMark }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="3 background tasks"');
    expect(html).toContain('data-tooltip="3 background tasks"');
    expect(html).toContain(`d="${ICONS.pulse}"`);
    expect(html).toContain('width="12"');
    expect(html).not.toContain("hourglass-turn");
  });

  it("let a scheduled task recede, its meaning in the label it is given", () => {
    const html = renderStatic(
      createElement(ScheduleMark, { label: "Scheduled", size: ICON_SIZE.rowMark }),
    );
    expect(html).toContain('aria-label="Scheduled"');
    expect(html).toContain('data-tooltip="Scheduled"');
    expect(html).toContain(`d="${ICONS.alarmClock}"`);
  });
});
