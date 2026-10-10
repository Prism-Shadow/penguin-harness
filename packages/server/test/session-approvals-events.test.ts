/**
 * `session_approvals` on the user channel: how many tool calls of a Session wait for a
 * person, published whenever that count changes, so a list (or any client watching every
 * Session of a Project) sees which Session waits without subscribing to each one's stream.
 *
 * - Given an always-ask Session whose Task calls a tool, when the call is escalated, the
 *   owner's channel hears the count 1; when the person answers it, the count 0.
 * - Given a Task waiting on two approvals, when it is interrupted, one event brings the count
 *   to 0 (the interrupt denies both).
 * - Given an allow-all Session, a call that nobody is asked about publishes nothing.
 * - A stranger with a live channel and no access to the Project hears nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  approvalDecision,
  assistantText,
  toolCall,
  userText,
  type ApproveFn,
  type OmniMessage,
} from "@prismshadow/penguin-core";
import type { ServerEvent } from "../src/api/types.js";
import { userChannelKey } from "../src/http/routes/events.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "owner-default_project";

/** A runtime whose Task asks to approve one call per id, in parallel, then answers. */
function approvingSession(sessionId: string, toolCallIds: string[]): RuntimeSession {
  return fakeSession(sessionId, {
    async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      const calls = toolCallIds.map((id) =>
        toolCall({ name: "exec_command", arguments: "{}", toolCallId: id }),
      );
      for (const tc of calls) yield tc;
      const decisions = await Promise.all(calls.map((tc) => opts.approve(tc)));
      for (const [i, decision] of decisions.entries()) {
        yield approvalDecision(decision, toolCallIds[i]!);
      }
      yield assistantText("done");
    },
  });
}

/** The `session_approvals` events one user's live channel received. */
function inbox(t: TestApp, userId: string) {
  const events: ServerEvent[] = [];
  t.deps.channels.get(userChannelKey(userId)).subscribe((evt) => {
    if (evt.event === "server_event") events.push(JSON.parse(evt.data) as ServerEvent);
  });
  return {
    events,
    approvals: () => events.flatMap((e) => (e.type === "session_approvals" ? [e] : [])),
  };
}

let t: TestApp;
let api: ReturnType<typeof apiClient>;

beforeAll(async () => {
  t = await createTestApp();
  api = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
  await provisionUser(t.app, "stranger");
});
afterAll(async () => {
  await t.cleanup();
});

describe("session_approvals on the user channel", () => {
  let SID: string;
  let owner: ReturnType<typeof inbox>;
  let stranger: ReturnType<typeof inbox>;

  beforeEach(() => {
    SID = uniqueSessionId();
    owner = inbox(t, "owner");
    stranger = inbox(t, "stranger");
  });

  it("an escalated call publishes the count 1, and the person's answer the count 0", async () => {
    adoptSession(t.deps, approvingSession(SID, ["tc-1"]), {
      projectId: PROJECT,
      approvalMode: "always-ask",
    });
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => owner.approvals().length === 1);
    expect(owner.approvals()).toEqual([{ type: "session_approvals", sessionId: SID, count: 1 }]);

    const res = await api.post(`/api/sessions/${SID}/approvals/tc-1`, { decision: "allow" });
    expect(res.status).toBe(204);
    expect(owner.approvals().at(-1)).toEqual({
      type: "session_approvals",
      sessionId: SID,
      count: 0,
    });
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(owner.approvals()).toHaveLength(2);
    expect(stranger.events).toEqual([]);
  });

  it("an interrupt that denies two waiting calls publishes one event, with the count 0", async () => {
    adoptSession(t.deps, approvingSession(SID, ["tc-a", "tc-b"]), {
      projectId: PROJECT,
      approvalMode: "always-ask",
    });
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 2);
    expect(owner.approvals().map((e) => e.count)).toEqual([1, 2]);

    t.deps.manager.abortTask(SID);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(owner.approvals().map((e) => e.count)).toEqual([1, 2, 0]);
  });

  it("a call nobody is asked about (allow-all) publishes nothing", async () => {
    adoptSession(t.deps, approvingSession(SID, ["tc-auto"]), {
      projectId: PROJECT,
      approvalMode: "allow-all",
    });
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(owner.approvals()).toEqual([]);
  });
});
