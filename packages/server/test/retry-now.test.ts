/**
 * Integration tests for POST /api/sessions/:id/retry-now ("retry now" on the reconnect
 * countdown — skips the in-progress backoff wait):
 *   - 200 {skipped:true} while the runtime reports a wait was skipped;
 *   - 200 {skipped:false} as a benign no-op when the session is idle or no wait is in
 *     progress (timing races must not surface as errors);
 *   - 404 for foreign/unknown sessions (via the shared resolveSession lookup).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall, userText } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type { RetryNowResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-27-10-00-00-ccdd0002";

/** Fake Session that parks on one approval (keeps the Task running) and records skip calls. */
function backoffFakeSession(sessionId: string, skips: number[]): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => {
      skips.push(Date.now());
      return true; // pretend a reconnect wait was in progress and got skipped
    },
    async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-retry" });
      yield tc;
      const decision = await opts.approve(tc);
      yield approvalDecision(decision, "tc-retry");
      yield assistantText("done");
    },
    async *compact() {},
  };
}

describe("retry-now route", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let skips: number[];

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "retrier");
    const other = await provisionUser(t.app, "outsider_r");
    api = apiClient(t.app, cookie);
    outsider = apiClient(t.app, other.cookie);
    t.deps.approvalModes.set("always-ask");
    const row: SessionRow = {
      sessionId: SID,
      projectId: "retrier-default_project",
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    skips = [];
    t.deps.manager.adopt(row, backoffFakeSession(SID, skips));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("idle → benign 200 {skipped:false}; the runtime is never poked", async () => {
    const res = await api.post(`/api/sessions/${SID}/retry-now`, {});
    expect(res.status).toBe(200);
    expect((await res.json()) as RetryNowResponse).toEqual({ skipped: false });
    expect(skips).toEqual([]);
  });

  it("running (parked in a wait) → 200 {skipped:true}, the skip reaches the runtime", async () => {
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const res = await api.post(`/api/sessions/${SID}/retry-now`, {});
    expect(res.status).toBe(200);
    expect((await res.json()) as RetryNowResponse).toEqual({ skipped: true });
    expect(skips).toHaveLength(1);

    t.deps.manager.decideApproval(SID, "tc-retry", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("foreign and unknown sessions → 404 (same auth semantics as the other session routes)", async () => {
    expect((await outsider.post(`/api/sessions/${SID}/retry-now`, {})).status).toBe(404);
    expect((await api.post(`/api/sessions/session-ghost/retry-now`, {})).status).toBe(404);
    expect(skips).toEqual([]);
  });
});
