/**
 * The source mark a row of the sidebar's Background folder carries (lib/session-source-mark.ts).
 *
 * - Given a Background row (an API, scheduled, subagent or CLI Session), it carries one mark
 *   with a tooltip, and no two sources share a drawing or a name.
 * - Given a person's conversation (`user`, or a row not yet classified), a company Session or
 *   an archived row of any source, it carries no source mark.
 * - Given a scheduled task's Session, its mark is not the alarm clock: that mark belongs to a
 *   task still to fire into a conversation, and one row must not show two alarms.
 * - In English, no mark falls back to a Chinese name.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo, SessionSource } from "@prismshadow/penguin-server/api";
import { ICONS } from "@prismshadow/penguin-ui";
import { backgroundSourceMark } from "../src/lib/session-source-mark";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

function session(over: { source?: SessionSource; archived?: boolean } = {}): SessionInfo {
  return {
    sessionId: "session-1",
    projectId: "proj",
    agentId: "default_agent",
    provider: "custom",
    modelId: "m1",
    workspace: "/srv/a",
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
    createdAt: "2026-10-07T10:00:00.000Z",
    lastActiveAt: "2026-10-07T10:00:00.000Z",
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: over.archived ?? false,
    ...(over.source !== undefined ? { source: over.source } : {}),
  };
}

const BACKGROUND = ["api", "schedule", "subagent", "cli"] as const;

describe("backgroundSourceMark", () => {
  it("marks every Background row, each source with a drawing and a name of its own", () => {
    const marks = BACKGROUND.map((source) => backgroundSourceMark(session({ source })));
    for (const mark of marks) {
      expect(mark?.sourceGlyph).toBeTruthy();
      expect(mark?.sourceLabel).toBeTruthy();
    }
    expect(new Set(marks.map((m) => m?.sourceGlyph)).size).toBe(BACKGROUND.length);
    expect(new Set(marks.map((m) => m?.sourceLabel)).size).toBe(BACKGROUND.length);
  });

  it("leaves a person's conversation, a company Session and every archived row unmarked", () => {
    expect(backgroundSourceMark(session({ source: "user" }))).toBeNull();
    expect(backgroundSourceMark(session())).toBeNull();
    expect(backgroundSourceMark(session({ source: "company" }))).toBeNull();
    for (const source of BACKGROUND) {
      expect(backgroundSourceMark(session({ source, archived: true }))).toBeNull();
    }
  });

  it("never draws a scheduled task's Session with the alarm clock a task still to fire uses", () => {
    expect(backgroundSourceMark(session({ source: "schedule" }))?.sourceGlyph).not.toBe(
      ICONS.alarmClock,
    );
  });

  it("names every source in English without falling back to Chinese", () => {
    setActiveStrings(en);
    for (const source of BACKGROUND) {
      expect(backgroundSourceMark(session({ source }))?.sourceLabel).not.toMatch(/\p{Script=Han}/u);
    }
  });
});
