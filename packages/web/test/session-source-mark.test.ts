/**
 * The source mark of a Session a program opened (lib/session-source-mark.ts), on the archive
 * page's rows and on a sidebar row the user kept.
 *
 * - Given an API, scheduled or CLI Session, archived or kept, it carries one mark with a
 *   tooltip, and no two sources share a drawing or a name.
 * - Given a person's conversation (`user`, or a row not yet classified), a subagent or a
 *   company Session, it carries no source mark.
 * - Given a scheduled task's Session, its mark is not the alarm clock: that mark belongs to a
 *   task still to fire into a conversation, and one row must not show two alarms.
 * - In English, no mark falls back to a Chinese name.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo, SessionSource } from "@prismshadow/penguin-server/api";
import { ICONS } from "@prismshadow/penguin-ui";
import { backgroundSourceMark, squadMark } from "../src/lib/session-source-mark";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

function session(
  over: {
    source?: SessionSource;
    archived?: boolean;
    squad?: string;
    parentSessionId?: string;
  } = {},
): SessionInfo {
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
    ...(over.squad !== undefined ? { squad: over.squad } : {}),
    ...(over.parentSessionId !== undefined ? { parentSessionId: over.parentSessionId } : {}),
  };
}

const PROGRAMS = ["api", "schedule", "cli"] as const;

describe("backgroundSourceMark", () => {
  it("marks a program's Session, archived or kept, each source with a drawing and a name of its own", () => {
    for (const archived of [true, false]) {
      const marks = PROGRAMS.map((source) => backgroundSourceMark(session({ source, archived })));
      for (const mark of marks) {
        expect(mark?.sourceGlyph).toBeTruthy();
        expect(mark?.sourceLabel).toBeTruthy();
      }
      expect(new Set(marks.map((m) => m?.sourceGlyph)).size).toBe(PROGRAMS.length);
      expect(new Set(marks.map((m) => m?.sourceLabel)).size).toBe(PROGRAMS.length);
    }
  });

  it("leaves a person's conversation, a subagent and a company Session unmarked", () => {
    expect(backgroundSourceMark(session({ source: "user" }))).toBeNull();
    expect(backgroundSourceMark(session())).toBeNull();
    expect(backgroundSourceMark(session({ source: "user", archived: true }))).toBeNull();
    expect(backgroundSourceMark(session({ source: "subagent" }))).toBeNull();
    expect(backgroundSourceMark(session({ source: "company" }))).toBeNull();
  });

  it("never draws a scheduled task's Session with the alarm clock a task still to fire uses", () => {
    expect(backgroundSourceMark(session({ source: "schedule" }))?.sourceGlyph).not.toBe(
      ICONS.alarmClock,
    );
  });

  it("names every source in English without falling back to Chinese", () => {
    setActiveStrings(en);
    for (const source of PROGRAMS) {
      expect(backgroundSourceMark(session({ source }))?.sourceLabel).not.toMatch(/\p{Script=Han}/u);
    }
  });
});

describe("squadMark", () => {
  it("marks a squad row with the users glyph and names the tag", () => {
    const mark = squadMark(session({ source: "subagent", squad: "e2e-live" }));
    expect(mark?.squadGlyph).toBe(ICONS.users);
    expect(mark?.squadLabel).toContain("e2e-live");
  });

  it("appends the short parent id when parentage is known", () => {
    const withParent = squadMark(
      session({ squad: "rc1", parentSessionId: "session-2026-10-12-12-13-26-b37b76" }),
    )?.squadLabel;
    const withoutParent = squadMark(session({ squad: "rc1" }))?.squadLabel;
    expect(withParent).toContain("rc1");
    expect(withParent).toContain("b37b76");
    expect(withoutParent).not.toContain("b37b76");
  });

  it("leaves untagged and archived rows unmarked", () => {
    expect(squadMark(session({ source: "subagent" }))).toBeNull();
    expect(squadMark(session())).toBeNull();
    expect(squadMark(session({ squad: "rc1", archived: true }))).toBeNull();
  });

  it("names the squad in English without falling back to Chinese", () => {
    setActiveStrings(en);
    expect(squadMark(session({ squad: "rc1" }))?.squadLabel).not.toMatch(/\p{Script=Han}/u);
  });
});
