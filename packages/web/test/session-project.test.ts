/**
 * session-project.ts unit tests: the Project isolation of a deep-linked Session, the probe
 * key that scopes a failed lookup to its Project, how the chat page settles which Session
 * the route names when the loaded list does not hold it, and what it does once that is settled:
 *
 * - a Session on screen is shown, and one nobody has answered for yet is waited for;
 * - a route naming no Session, a Session deleted from this page and one of another Project
 *   (a Project switch) all open the latest conversation;
 * - a Session the server says does not exist is owned up to in place, never replaced by
 *   another conversation.
 */
import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import {
  resolveRoutedSession,
  routeSessionOutcome,
  sessionForProject,
  sessionProbeKey,
} from "../src/features/chat/session-project";

const SESSION: SessionInfo = {
  sessionId: "session-a",
  projectId: "project-a",
  agentId: "default_agent",
  provider: "anthropic",
  modelId: "claude-sonnet-4",
  workspace: "/workspace",
  approvalMode: "allow-all",
  sandbox: { mode: "danger-full-access", network: "open" },
  createdAt: "2026-08-24T00:00:00.000Z",
  lastActiveAt: "2026-08-24T00:00:00.000Z",
  status: "idle",
  pendingApprovalCount: 0,
  pendingFollowUpCount: 0,
  hasTrace: true,
  archived: false,
};

describe("Session Project isolation", () => {
  it("accepts a deep-linked Session from the current Project", () => {
    expect(sessionForProject(SESSION, "project-a")).toBe(SESSION);
  });

  it("rejects a deep-linked Session from another Project", () => {
    expect(sessionForProject(SESSION, "project-b")).toBeNull();
  });

  it("does not reuse a probe failure after switching Projects", () => {
    expect(sessionProbeKey("project-a", SESSION.sessionId)).not.toBe(
      sessionProbeKey("project-b", SESSION.sessionId),
    );
  });
});

describe("resolveRoutedSession", () => {
  const other: SessionInfo = { ...SESSION, sessionId: "session-b" };

  it("takes the list's row when it holds one", () => {
    expect(resolveRoutedSession("session-a", [other, SESSION], null)).toBe(SESSION);
  });

  it("prefers the list's row over the fetched one — the list is the row events keep current", () => {
    const stale: SessionInfo = { ...SESSION, status: "running" };
    expect(resolveRoutedSession("session-a", [SESSION], stale)).toBe(SESSION);
  });

  it("falls back to the fetched row, which is what survives a list reload dropping it", () => {
    // An organization's desk opened from the org chart: never in the development list, and
    // dropped from the store again by the next reload.
    expect(resolveRoutedSession("session-a", [], SESSION)).toBe(SESSION);
    expect(resolveRoutedSession("session-a", [other], SESSION)).toBe(SESSION);
  });

  it("ignores a fetched row for another id, and answers nothing without a route", () => {
    expect(resolveRoutedSession("session-a", [], other)).toBeNull();
    expect(resolveRoutedSession(null, [SESSION], SESSION)).toBeNull();
  });
});

describe("routeSessionOutcome", () => {
  const settled = {
    shown: false,
    pending: false,
    routeSessionId: "session-a",
    deletedHere: false,
    missing: false,
  };

  it("shows a Session on screen, and waits for one nobody has answered for yet", () => {
    expect(routeSessionOutcome({ ...settled, shown: true, missing: true })).toBe("show");
    expect(routeSessionOutcome({ ...settled, pending: true })).toBe("wait");
  });

  it("opens the latest conversation when the route names no Session", () => {
    expect(routeSessionOutcome({ ...settled, routeSessionId: null })).toBe("redirect");
  });

  it("opens the latest conversation after the one on screen was deleted from this page", () => {
    // The lookup of a Session deleted here is never sent, so nothing says "missing"; and even
    // a 404 that raced the delete does not turn it into a dead link.
    expect(routeSessionOutcome({ ...settled, deletedHere: true })).toBe("redirect");
    expect(routeSessionOutcome({ ...settled, deletedHere: true, missing: true })).toBe("redirect");
  });

  it("opens the latest conversation for a Session of another Project, as a Project switch leaves behind", () => {
    expect(routeSessionOutcome(settled)).toBe("redirect");
  });

  it("says in place that a Session the server does not have is gone, rather than opening another", () => {
    expect(routeSessionOutcome({ ...settled, missing: true })).toBe("notFound");
  });
});
