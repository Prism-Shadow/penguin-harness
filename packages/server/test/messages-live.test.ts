/**
 * GET /api/sessions/:id/messages live-tail integration: while a Task runs, the response
 * carries `live` — a channel cursor plus one synthetic `partial_* start` per open
 * streaming fragment (origin preserved for subagent fragments); once the run ends the
 * field disappears and the tail is cleared.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approvalDecision,
  approvalDecisionOf,
  assistantText,
  partialText,
  partialThinking,
  partialToolCallOutput,
  requestBegin,
  toolCall,
  toolCallOutput,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type { MessagesResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-25-10-00-00-cafe0001";

/**
 * Fake session frozen mid-stream: it streams a thinking fragment, a closed text segment,
 * a tool call with a partially streamed output, and a subagent text fragment, then blocks
 * on approval (always-ask) so the Task stays running while the test inspects /messages.
 */
function midStreamFakeSession(sessionId: string): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      // A real run opens its first LLM request before any model output — and the
      // manager's pending-input holds end exactly there.
      yield requestBegin();
      yield partialThinking("start");
      yield partialThinking("delta", "let me think");
      // A closed segment: start+delta+stop+complete leaves no open fragment behind.
      yield partialText("start", "");
      yield partialText("delta", "Hello");
      yield partialText("stop");
      yield assistantText("Hello");
      const tc = toolCall({ name: "exec_command", arguments: '{"cmd":"x"}', toolCallId: "tc-lv" });
      yield tc;
      yield withOrigin(partialText("start", "child says "), "child-1");
      yield partialToolCallOutput({ eventType: "start", toolCallId: "tc-lv" });
      yield partialToolCallOutput({ eventType: "delta", output: "line 1\n", toolCallId: "tc-lv" });
      const decision = approvalDecisionOf(await opts.approve(tc)); // blocks until the test decides
      yield approvalDecision(decision, "tc-lv");
      yield toolCallOutput({ output: "line 1\nline 2\n", toolCallId: "tc-lv" });
      yield assistantText("done");
    },
    async *compact() {},
  };
}

describe("messages live tail", () => {
  let t: TestApp;
  let cookie: string;
  let row: SessionRow;

  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "livetailer"));
    row = {
      sessionId: SID,
      projectId: "livetailer-default_project",
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const getMessages = async (query = ""): Promise<MessagesResponse> => {
    const res = await apiClient(t.app, cookie).get(`/api/sessions/${SID}/messages${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as MessagesResponse;
  };

  it("no `live` field while idle", async () => {
    const body = await getMessages();
    expect(body.messages).toEqual([]);
    expect(body.live).toBeUndefined();
  });

  it("while running: `live` carries the cursor and one synthetic start per open fragment (origin preserved); it disappears once the run ends", async () => {
    t.deps.manager.adopt(row, midStreamFakeSession(SID));
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const body = await getMessages();
    expect(body.live).toBeDefined();
    expect(body.live!.cursor).toMatch(/^[0-9a-f]{8}-\d+$/);
    const frags = body.live!.fragments.map((f) => ({
      type: (f.payload as { type: string }).type,
      origin: f.origin,
    }));
    // Closed segments (the text) leave nothing; the thinking, the subagent text and the
    // tool output are still open. All are `start` events with accumulated content.
    expect(frags).toEqual([
      { type: "partial_thinking", origin: undefined },
      { type: "partial_text", origin: ["child-1"] },
      { type: "partial_tool_call_output", origin: undefined },
    ]);
    for (const f of body.live!.fragments) {
      expect((f.payload as { event_type: string }).event_type).toBe("start");
    }
    expect((body.live!.fragments[0]!.payload as { thinking: string }).thinking).toBe(
      "let me think",
    );
    expect((body.live!.fragments[1]!.payload as { text: string }).text).toBe("child says ");
    const out = body.live!.fragments[2]!.payload as { output: string; tool_call_id: string };
    expect(out.output).toBe("line 1\n");
    expect(out.tool_call_id).toBe("tc-lv");

    // Let the run finish: the tail is cleared and `live` disappears.
    expect(t.deps.manager.decideApproval(SID, "tc-lv", "deny")).toBe(true);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(t.deps.manager.liveFragments(SID)).toEqual([]);
    const after = await getMessages();
    expect(after.live).toBeUndefined();
  });

  it("windowed reads: `live` rides TAIL pages with identical semantics and never rides `before` pages", async () => {
    t.deps.manager.adopt(row, midStreamFakeSession(SID));
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const full = await getMessages();
    const tail = await getMessages("?tailLimit=5");
    expect(tail.page).toBeDefined();
    expect(tail.live).toBeDefined();
    // Same capture as the full read: cursor shape and open-fragment snapshot.
    expect(tail.live!.cursor).toMatch(/^[0-9a-f]{8}-\d+$/);
    expect(tail.live!.fragments.map((f) => (f.payload as { type: string }).type)).toEqual(
      full.live!.fragments.map((f) => (f.payload as { type: string }).type),
    );

    // A `before` page is immutable history: never a live attachment, even mid-run.
    const before = await getMessages("?before=1:0&limit=5");
    expect(before.page).toBeDefined();
    expect(before.live).toBeUndefined();

    expect(t.deps.manager.decideApproval(SID, "tc-lv", "deny")).toBe(true);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("the parameterless read stays byte-identical to the pre-pagination contract (no page envelope)", async () => {
    t.deps.manager.adopt(row, midStreamFakeSession(SID));
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    expect(t.deps.manager.decideApproval(SID, "tc-lv", "deny")).toBe(true);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    const res = await apiClient(t.app, cookie).get(`/api/sessions/${SID}/messages`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as MessagesResponse;
    expect(Object.keys(body)).toEqual(["messages"]);
    // Exactly the legacy serialization: the full transcript and nothing else.
    const expected = JSON.stringify({
      messages: await t.deps.traceService.readMessages(row.projectId, row.agentId, row.sessionId),
    });
    expect(raw).toBe(expected);
    // Windowed-param validation stays loud rather than guessy.
    const bad = await apiClient(t.app, cookie).get(
      `/api/sessions/${SID}/messages?tailLimit=5&before=1:0`,
    );
    expect(bad.status).toBe(400);
    const badLimit = await apiClient(t.app, cookie).get(`/api/sessions/${SID}/messages?limit=5`);
    expect(badLimit.status).toBe(400);
    const badCursor = await apiClient(t.app, cookie).get(
      `/api/sessions/${SID}/messages?before=xyz`,
    );
    expect(badCursor.status).toBe(400);
  });
});
