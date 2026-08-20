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

/**
 * Icon rendering contract, via react-dom/server static markup (node env, no DOM).
 *
 * Two shapes carry the two situations that differ in KIND — busy vs settled. Within each, the
 * remaining distinction is a colour, which is exactly why every glyph is also required below to
 * name its precise state in its accessible name and tooltip: the colour is never the only way
 * to find out what a row is doing.
 */
describe("SessionActivityIcon", () => {
  const ACTIVITIES: readonly Activity[] = ["running", "compacting", "completedUnread"];

  const render = (activity: Activity) =>
    renderToStaticMarkup(createElement(SessionActivityIcon, { activity }));

  it("draws one hourglass for both busy states", () => {
    expect(ACTIVITY_GLYPH.compacting).toBe(ACTIVITY_GLYPH.running);
    for (const activity of ["running", "compacting"] as const) {
      expect(render(activity)).toContain(`d="${ACTIVITY_GLYPH[activity]}"`);
    }
  });

  it("draws the unread state as a dot, not as a path glyph", () => {
    const unread = render("completedUnread");
    expect(unread).toContain("rounded-full");
    expect(unread).not.toContain("<svg");
    expect(unread).not.toContain(ACTIVITY_GLYPH.running);
  });

  it("labels each state distinctly for screen readers and hover", () => {
    expect(sessionActivityLabel("running")).toBe(S.chat.statusRunning);
    expect(sessionActivityLabel("compacting")).toBe(S.chat.statusCompacting);
    expect(sessionActivityLabel("completedUnread")).toBe(S.chat.statusCompletedUnread);
    // Three states, three different names: the compacting/running pair differs only in colour
    // on screen, so nothing may be distinguishable by colour alone to a screen reader.
    expect(new Set(ACTIVITIES.map(sessionActivityLabel)).size).toBe(ACTIVITIES.length);
    for (const activity of ACTIVITIES) {
      expect(render(activity)).toContain(`aria-label="${sessionActivityLabel(activity)}"`);
    }
  });

  it("gives the hourglass a hover tooltip through the svg title child", () => {
    for (const activity of ["running", "compacting"] as const) {
      expect(render(activity)).toContain(`<title>${sessionActivityLabel(activity)}</title>`);
    }
    // The dot is an HTML span, so its tooltip is a plain title attribute.
    expect(render("completedUnread")).toContain(
      `title="${sessionActivityLabel("completedUnread")}"`,
    );
  });

  it("announces busy states as status and the unread dot as an image", () => {
    expect(render("running")).toContain('role="status"');
    expect(render("compacting")).toContain('role="status"');
    expect(render("completedUnread")).toContain('role="img"');
  });

  it("turns the hourglass while busy and leaves the dot still", () => {
    expect(render("running")).toContain("hourglass-turn");
    expect(render("compacting")).toContain("hourglass-turn");
    expect(render("completedUnread")).not.toContain("hourglass-turn");
  });

  it("keeps the two busy states apart by ink, since shape cannot separate them", () => {
    expect(render("running")).toContain("text-gray-500");
    expect(render("running")).toContain("dark:text-gray-400");
    expect(render("compacting")).toContain("text-amber-600");
    expect(render("compacting")).toContain("dark:text-amber-400");
  });

  it("draws the dot in the Session status dot's own emerald and geometry", () => {
    // Same green and same 6px as the dot this replaces, at both surfaces: `h-1.5 w-1.5
    // rounded-full bg-emerald-500`, one tone in both themes, no per-theme override.
    const unread = render("completedUnread");
    expect(unread).toContain("bg-emerald-500");
    expect(unread).not.toMatch(/dark:bg-emerald-/);
    expect(unread).toContain("h-1.5 w-1.5");
    expect(unread).toContain("rounded-full");
    // The reservation must never inflate the mark: no larger dot sneaking back in.
    expect(unread).not.toMatch(/\bh-2 w-2\b/);
  });

  it("occupies the same box whatever the glyph, so a row never shifts", () => {
    // Every glyph renders into the same 12px box, and the sidebar reserves that same box when
    // there is no glyph at all — otherwise the title would re-flow as a run starts, finishes and
    // is read. The 6px dot is CENTRED in that box rather than sized to it: the box is the
    // reservation, the dot is the mark.
    for (const activity of ACTIVITIES) {
      const markup = render(activity);
      expect(markup).toMatch(/(width="12"|width:12px)/);
      expect(markup).toMatch(/(height="12"|height:12px)/);
    }
    // The empty state's placeholder, read from the sidebar itself so it cannot drift apart.
    const sidebar = readFileSync(
      fileURLToPath(new URL("../src/components/layout/sidebar.tsx", import.meta.url)),
      "utf8",
    );
    expect(sidebar).toMatch(/activity === null.*\n?.*className="block h-3 w-3 shrink-0"/);
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
