/**
 * The activity marks: each live state a shape and a motion of its own in one attention ink, the
 * unread state a success dot centred in the same box, every state named by the caller's label —
 * and the two marks beside them in the busy and the subtle ink. The motion lives in theme.css
 * and must leave the glyph upright and visible when animation is switched off.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { classTokens, renderStatic, stripCssComments } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

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

  it("inks both live states with the attention tone", () => {
    for (const activity of ["running", "compacting"] as const) {
      expect(classTokens(render(activity))).toContain("text-tone-attention-fg");
    }
  });

  it("draws the unread state as the success dot, not a glyph", () => {
    const unread = render("completedUnread");
    expect(unread).not.toContain("<svg");
    expect(classTokens(unread)).toEqual(
      expect.arrayContaining(["bg-tone-success-emphasis", "rounded-full"]),
    );
    expect(unread).toContain("width:6px;height:6px");
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
  it("draw background work in the busy ink, named by the caller, at the caller's rung", () => {
    const html = renderStatic(
      createElement(BackgroundTasksMark, { label: "3 background tasks", size: ICON_SIZE.rowMark }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="3 background tasks"');
    expect(html).toContain('data-tooltip="3 background tasks"');
    expect(html).toContain(`d="${ICONS.pulse}"`);
    expect(html).toContain('width="12"');
    expect(classTokens(html)).toContain("text-tone-success-fg");
    expect(html).not.toContain("hourglass-turn");
  });

  it("let a scheduled task recede, its meaning in the label it is given", () => {
    const html = renderStatic(
      createElement(ScheduleMark, { label: "Scheduled", size: ICON_SIZE.rowMark }),
    );
    expect(html).toContain('aria-label="Scheduled"');
    expect(html).toContain('data-tooltip="Scheduled"');
    expect(html).toContain(`d="${ICONS.alarmClock}"`);
    const tokens = classTokens(html);
    expect(tokens).toContain("text-fg-subtle");
    expect(tokens.some((t) => t.startsWith("text-tone-"))).toBe(false);
  });
});

describe("the activity motion in theme.css", () => {
  const sheet = stripCssComments(readFileSync(join(SRC_DIR, "theme.css"), "utf8"));

  /** A keyframes block's body, braces balanced, or "" when the sheet has none by that name. */
  const keyframes = (name: string) => {
    const start = sheet.indexOf(`@keyframes ${name}`);
    if (start < 0) return "";
    const open = sheet.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < sheet.length; i++) {
      if (sheet[i] === "{") depth++;
      else if (sheet[i] === "}" && --depth === 0) return sheet.slice(open + 1, i);
    }
    return "";
  };

  it("runs each mark's keyframes on its class", () => {
    expect(sheet).toMatch(/\.hourglass-turn\s*\{[^}]*animation:\s*hourglass-turn\s/);
    expect(sheet).toMatch(/\.compact-squeeze\s*\{[^}]*animation:\s*compact-squeeze\s/);
  });

  it("only transforms, so with animation off the glyph stands upright, still visible", () => {
    for (const name of ["hourglass-turn", "compact-squeeze"]) {
      const body = keyframes(name);
      expect(body, name).not.toBe("");
      const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(new Set(properties), name).toEqual(new Set(["transform"]));
    }
    expect(keyframes("hourglass-turn")).toMatch(/rotate\(180deg\)/); // A turn, not a spin.
  });

  it("stops under the gallery's switch and the system preference", () => {
    expect(sheet).toMatch(
      /:root\[data-motion="reduced"\]\s*:is\(\.hourglass-turn,\s*\.compact-squeeze\)\s*\{\s*animation:\s*none;/,
    );
    const media = sheet.slice(sheet.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(media).toMatch(/:is\(\.hourglass-turn,\s*\.compact-squeeze\)\s*\{\s*animation:\s*none;/);
  });
});
