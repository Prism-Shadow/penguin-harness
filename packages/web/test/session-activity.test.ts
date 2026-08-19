import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionActivity } from "../src/lib/session-activity";
import type { SessionActivity } from "../src/lib/session-activity";
import {
  ACTIVITY_GLYPH,
  SessionActivityIcon,
  sessionActivityLabel,
} from "../src/components/ui/session-activity-icon";
import { S } from "../src/lib/strings";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Activity = Exclude<SessionActivity, null>;

describe("sessionActivity", () => {
  it("reports a live run whatever the read state, compaction included", () => {
    expect(sessionActivity("running", true, false)).toBe("running");
    expect(sessionActivity("running", true, true)).toBe("running");
    expect(sessionActivity("compacting", true, false)).toBe("compacting");
    expect(sessionActivity("compacting", true, true)).toBe("compacting");
  });

  it("splits a settled Session by whether its last reply has been read", () => {
    expect(sessionActivity("idle", true, false)).toBe("completed");
    expect(sessionActivity("idle", true, true)).toBe("completedUnread");
  });

  it("shows nothing for a Session that has never run", () => {
    expect(sessionActivity("idle", false, false)).toBeNull();
    // Unread is meaningless without a reply to have missed.
    expect(sessionActivity("idle", false, true)).toBeNull();
  });

  it("still reports a live run started before its Trace was recorded", () => {
    expect(sessionActivity("running", false, false)).toBe("running");
    expect(sessionActivity("compacting", false, false)).toBe("compacting");
  });
});

/**
 * Icon rendering contract, via react-dom/server static markup (node env, no DOM).
 *
 * Two shapes carry the two situations that differ in KIND — busy vs settled. Within each, the
 * remaining distinction is a colour, which is exactly why every glyph is also required below to
 * name its precise state in its accessible name and tooltip: the colour is never the only way
 * to find out what a row is doing.
 */
describe("SessionActivityIcon", () => {
  const ACTIVITIES: readonly Activity[] = ["running", "compacting", "completed", "completedUnread"];

  const render = (activity: Activity) =>
    renderToStaticMarkup(createElement(SessionActivityIcon, { activity }));

  it("draws the hourglass for both busy states and the circled check for both settled ones", () => {
    expect(ACTIVITY_GLYPH.compacting).toBe(ACTIVITY_GLYPH.running);
    expect(ACTIVITY_GLYPH.completedUnread).toBe(ACTIVITY_GLYPH.completed);
    // Busy and settled must NOT collapse into one shape.
    expect(ACTIVITY_GLYPH.running).not.toBe(ACTIVITY_GLYPH.completed);
    for (const activity of ACTIVITIES) {
      expect(render(activity)).toContain(`d="${ACTIVITY_GLYPH[activity]}"`);
    }
  });

  it("labels each state distinctly for screen readers and hover", () => {
    expect(sessionActivityLabel("running")).toBe(S.chat.statusRunning);
    expect(sessionActivityLabel("compacting")).toBe(S.chat.statusCompacting);
    expect(sessionActivityLabel("completed")).toBe(S.chat.statusCompleted);
    expect(sessionActivityLabel("completedUnread")).toBe(S.chat.statusCompletedUnread);
    // Four states, four different names: nothing is distinguishable by colour alone to a
    // screen reader, including read vs unread.
    expect(new Set(ACTIVITIES.map(sessionActivityLabel)).size).toBe(ACTIVITIES.length);
    for (const activity of ACTIVITIES) {
      const markup = render(activity);
      const label = sessionActivityLabel(activity);
      expect(markup).toContain(`aria-label="${label}"`);
      // The svg <title> child is what browsers surface as the hover tooltip.
      expect(markup).toContain(`<title>${label}</title>`);
    }
  });

  it("announces busy states as status and settled ones as an image", () => {
    expect(render("running")).toContain('role="status"');
    expect(render("compacting")).toContain('role="status"');
    expect(render("completed")).toContain('role="img"');
    expect(render("completedUnread")).toContain('role="img"');
  });

  it("turns the hourglass while busy and leaves the settled check still", () => {
    expect(render("running")).toContain("hourglass-turn");
    expect(render("compacting")).toContain("hourglass-turn");
    expect(render("completed")).not.toContain("hourglass-turn");
    expect(render("completedUnread")).not.toContain("hourglass-turn");
  });

  it("gives read and unread different ink, since colour is their only visual difference", () => {
    // Distinct in BOTH themes: a pair that only diverged in light mode would collapse in dark.
    const read = render("completed");
    const unread = render("completedUnread");
    expect(read).toContain("text-gray-400");
    expect(read).toContain("dark:text-gray-600");
    expect(unread).toContain("text-emerald-700");
    expect(unread).toContain("dark:text-emerald-400");
  });
});

/**
 * The turning hourglass must degrade to a still, VISIBLE hourglass under reduced motion. The
 * global rule kills `animation` outright, so the guarantee is that the keyframes only ever
 * rotate — no opacity, no display, nothing whose absence would blank the glyph (the login
 * traces in the same stylesheet need an explicit override for exactly that reason).
 */
describe("hourglass-turn reduced motion", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");

  it("is an animation, so the global reduced-motion rule disables it", () => {
    expect(css).toMatch(/\.hourglass-turn\s*\{[^}]*animation:\s*hourglass-turn/);
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?animation:\s*none\s*!important/,
    );
  });

  it("only rotates, so disabling it leaves the glyph upright rather than invisible", () => {
    const block = /@keyframes hourglass-turn\s*\{([\s\S]*?)\n\}/.exec(css);
    const body = block?.[1] ?? "";
    expect(body).not.toBe("");
    const declarations = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect(new Set(declarations)).toEqual(new Set(["transform"]));
    expect(body).toMatch(/rotate\(180deg\)/); // A turn, not a spin.
  });
});
