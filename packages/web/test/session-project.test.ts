import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { sessionForProject, sessionProbeKey } from "../src/features/chat/session-project";

const SESSION: SessionInfo = {
  sessionId: "session-a",
  projectId: "project-a",
  agentId: "default_agent",
  provider: "anthropic",
  modelId: "claude-sonnet-4",
  workspace: "/workspace",
  approvalMode: "allow-all",
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
