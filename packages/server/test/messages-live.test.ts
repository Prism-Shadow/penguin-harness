/**
 * GET /api/sessions/:id/messages live-tail integration: while a Task runs, the response
 * carries `live` — a channel cursor plus one synthetic `partial_* start` per open
 * streaming fragment (origin preserved for subagent fragments); once the run ends the
 * field disappears and the tail is cleared.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approvalDecision,
  assistantText,
  partialText,
  partialThinking,
  partialToolCallOutput,
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
      const decision = await opts.approve(tc); // blocks until the test decides
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
    t.deps.approvalModes.set("livetailer", "always-ask");
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
    };
    t.deps.sessionsRepo.insert(row);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const getMessages = async (): Promise<MessagesResponse> => {
    const res = await apiClient(t.app, cookie).get(`/api/sessions/${SID}/messages`);
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
    await t.deps.manager.startTask(SID, [userText("go")], {
      approvalUserId: "livetailer",
    });
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
});
