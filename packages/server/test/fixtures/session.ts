/**
 * The suite's stand-in for a running core Session: the SessionManager's RuntimeSession seam,
 * behind which the LLM and the Environment live. Every member answers the way an idle Session
 * with nothing to report does, and a test overrides only what its scenario is about — most
 * often `run`, the scripted stream of messages one Task yields.
 *
 * `adoptSession` indexes a Session row and adopts the fake as its runtime, the state a Session
 * is in right after it was opened, so the routes, the bridge and the manager can drive it.
 */
import type { SessionRow } from "../../src/db/repos/sessions.js";
import type { RuntimeSession } from "../../src/runtime/session-manager.js";
import type { TestDeps } from "../helpers.js";

export function fakeSession(
  sessionId: string,
  overrides: Partial<Omit<RuntimeSession, "sessionId">> = {},
): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok",
    steer: () => false,
    skipReconnectWait: () => false,
    async *run() {},
    async *compact() {},
    ...overrides,
  };
}

let sequence = 0;

/** A Session id no other test in this process holds, in the shape the server mints. */
export function uniqueSessionId(): string {
  sequence += 1;
  return `session-2026-09-01-10-00-00-${sequence.toString(16).padStart(8, "0")}`;
}

/** An index row for `sessionId`; the scenario overrides what it depends on (its Project, its approval mode). */
export function sessionRow(sessionId: string, fields: Partial<SessionRow> = {}): SessionRow {
  const now = new Date().toISOString();
  return {
    sessionId,
    projectId: "default_project",
    agentId: "default_agent",
    provider: "custom",
    modelId: "m1",
    workspace: "/tmp/w",
    approvalMode: "allow-all",
    title: null,
    createdAt: now,
    lastActiveAt: now,
    ...fields,
  };
}

/** Indexes `session`'s row and adopts the fake as its runtime; returns the row. */
export function adoptSession(
  deps: Pick<TestDeps, "sessionsRepo" | "manager">,
  session: RuntimeSession,
  fields: Partial<SessionRow> = {},
): SessionRow {
  const row = sessionRow(session.sessionId, fields);
  deps.sessionsRepo.insert(row);
  deps.manager.adopt(row, session);
  return row;
}
