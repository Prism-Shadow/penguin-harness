/**
 * POST /api/sessions/:id/retry-now: "retry now" on the reconnect countdown, which skips the
 * backoff wait in progress.
 *
 * - Given an idle Session, the route answers a benign 200 `{skipped:false}` and never pokes
 *   the runtime (a timing race must not surface as an error).
 * - Given a running Session parked in a wait, it answers `{skipped:true}` and the skip reaches
 *   the runtime.
 * - A foreign or unknown Session is a 404, as on every other Session route.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall, userText } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type { RetryNowResponse } from "../src/api/types.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("retry-now route", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let sid: string;
  let skips: number;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "retrier")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "outsider_r")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // A Session that parks on one approval (keeping its Task running) and reports every skip as
  // one that interrupted a reconnect wait.
  beforeEach(() => {
    sid = uniqueSessionId();
    skips = 0;
    const session = fakeSession(sid, {
      skipReconnectWait: () => {
        skips += 1;
        return true;
      },
      async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
        const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-retry" });
        yield tc;
        yield approvalDecision(await opts.approve(tc), "tc-retry");
        yield assistantText("done");
      },
    });
    adoptSession(t.deps, session, {
      projectId: "retrier-default_project",
      approvalMode: "always-ask",
    });
  });

  it("idle → benign 200 {skipped:false}; the runtime is never poked", async () => {
    const res = await api.post(`/api/sessions/${sid}/retry-now`, {});
    expect(res.status).toBe(200);
    expect((await res.json()) as RetryNowResponse).toEqual({ skipped: false });
    expect(skips).toBe(0);
  });

  it("running (parked in a wait) → 200 {skipped:true}, the skip reaches the runtime", async () => {
    await t.deps.manager.startTask(sid, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(sid) === 1);

    const res = await api.post(`/api/sessions/${sid}/retry-now`, {});
    expect(res.status).toBe(200);
    expect((await res.json()) as RetryNowResponse).toEqual({ skipped: true });
    expect(skips).toBe(1);

    t.deps.manager.decideApproval(sid, "tc-retry", "allow");
    await waitFor(() => t.deps.manager.statusOf(sid) === "idle");
  });

  it("foreign and unknown sessions → 404 (same auth semantics as the other session routes)", async () => {
    expect((await outsider.post(`/api/sessions/${sid}/retry-now`, {})).status).toBe(404);
    expect((await api.post(`/api/sessions/session-ghost/retry-now`, {})).status).toBe(404);
    expect(skips).toBe(0);
  });
});
