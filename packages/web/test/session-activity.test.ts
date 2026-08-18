import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  advanceCompletionHighlights,
  dismissCompletionHighlight,
  sessionActivity,
} from "../src/lib/session-activity";
import type { SessionActivity } from "../src/lib/session-activity";
import {
  ACTIVITY_GLYPH,
  SessionActivityIcon,
  sessionActivityLabel,
} from "../src/components/ui/session-activity-icon";
import { S } from "../src/lib/strings";

describe("sessionActivity", () => {
  it("maps server activity first, then the transient completion marker", () => {
    expect(sessionActivity("running", false)).toBe("running");
    expect(sessionActivity("running", true)).toBe("running");
    expect(sessionActivity("compacting", false)).toBe("compacting");
    expect(sessionActivity("idle", true)).toBe("completed");
    expect(sessionActivity("idle", false)).toBeNull();
  });
});

describe("completion highlights", () => {
  it("records active-to-idle and never invents a completion from an idle snapshot", () => {
    const empty = new Set<string>();
    expect(advanceCompletionHighlights(empty, "a", "idle", "idle")).toBe(empty);
    const completed = advanceCompletionHighlights(empty, "a", "running", "idle");
    expect([...completed]).toEqual(["a"]);
  });

  it("keeps the highlight through idle observations and clears it when a new run starts", () => {
    const completed = new Set(["a"]);
    expect(advanceCompletionHighlights(completed, "a", "idle", "idle")).toBe(completed);
    expect([...advanceCompletionHighlights(completed, "a", "idle", "running")]).toEqual([]);
    expect([...advanceCompletionHighlights(completed, "a", "idle", "compacting")]).toEqual([]);
  });

  it("dismisses only the Session that was opened", () => {
    const completed = new Set(["a", "b"]);
    expect([...dismissCompletionHighlight(completed, "a")]).toEqual(["b"]);
    expect(dismissCompletionHighlight(completed, "missing")).toBe(completed);
  });
});

/**
 * Icon rendering contract, via react-dom/server static markup (node env, no DOM):
 * every activity must be told apart by glyph SHAPE (hourglass / inward chevrons / circled
 * check), not merely by color, and each glyph must carry its localized accessible name.
 */
describe("SessionActivityIcon", () => {
  const ACTIVITIES: readonly Exclude<SessionActivity, null>[] = [
    "running",
    "compacting",
    "completed",
  ];

  const render = (activity: Exclude<SessionActivity, null>) =>
    renderToStaticMarkup(createElement(SessionActivityIcon, { activity }));

  it("gives every state its own glyph shape, not just a color", () => {
    expect(new Set(Object.values(ACTIVITY_GLYPH)).size).toBe(ACTIVITIES.length);
    for (const activity of ACTIVITIES) {
      expect(render(activity)).toContain(`d="${ACTIVITY_GLYPH[activity]}"`);
    }
  });

  it("labels each glyph for screen readers and hover", () => {
    expect(sessionActivityLabel("running")).toBe(S.chat.statusRunning);
    expect(sessionActivityLabel("compacting")).toBe(S.chat.statusCompacting);
    expect(sessionActivityLabel("completed")).toBe(S.chat.statusCompleted);
    for (const activity of ACTIVITIES) {
      const markup = render(activity);
      const label = sessionActivityLabel(activity);
      expect(markup).toContain(`aria-label="${label}"`);
      // The svg <title> child is what browsers surface as the hover tooltip.
      expect(markup).toContain(`<title>${label}</title>`);
    }
  });

  it("announces live states as status and the settled checkmark as an image", () => {
    expect(render("running")).toContain('role="status"');
    expect(render("compacting")).toContain('role="status"');
    expect(render("completed")).toContain('role="img"');
  });
});
