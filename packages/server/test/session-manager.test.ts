/**
 * Unit tests for the Session runtime (a fake Session / Loader is injected; no
 * real LLM requests are made): driving and state transitions, 409 mutual
 * exclusion, the four approval modes and taking effect immediately on change,
 * abort collapsing to deny, self-healing id swaps, and LLM / tool errors in the
 * message stream being persisted (core doesn't throw, so try/catch can't catch them).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  abortEvent,
  approvalDecision,
  assistantText,
  compactionBegin,
  compactionEnd,
  requestBegin,
  requestEnd,
  sessionMeta,
  thinkingMessage,
  toolCall,
  toolCallOutput,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import { openDatabase } from "../src/db/database.js";
import { HttpError } from "../src/http/errors.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { ChannelHub } from "../src/runtime/channel.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import type { ErrorRecordArgs, ErrorSink } from "../src/runtime/error-recorder.js";
import { SessionManager } from "../src/runtime/session-manager.js";
import type { RuntimeSession, SessionLoader } from "../src/runtime/session-manager.js";
import type { TitleRequest } from "../src/runtime/title-generator.js";
import type { UsageContext } from "../src/runtime/usage-recorder.js";
import { waitFor } from "./helpers.js";

const ROW: SessionRow = {
  sessionId: "session-1",
  projectId: "p1",
  agentId: "a1",
  modelId: "m1",
  provider: "custom",
  workspace: "/tmp/w",
  approvalMode: "always-ask",
  title: null,
  createdAt: "2026-07-06T00:00:00.000Z",
};

/** A simple, scriptable fake Session: run yields one tool_call and requests approval for it. */
function approvalFakeSession(sessionId: string, toolName = "exec_command"): RuntimeSession {
  return {
    sessionId,
    toolPermission: (name) => (name === "read_tool" ? "r" : "rw"),
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      const tc = toolCall({ name: toolName, arguments: "{}", toolCallId: "tc-1" });
      yield tc;
      const decision = await opts.approve(tc);
      yield approvalDecision(decision, "tc-1");
      if (opts.signal.aborted) {
        yield abortEvent();
        return;
      }
      yield assistantText(`decision=${decision}`);
    },
    async *compact() {
      yield compactionBegin({ reason: "manual", mode: "summarize", context: 1, turns: 1 });
      yield compactionEnd({ reason: "manual", mode: "summarize", status: "completed" });
    },
  };
}

describe("session-manager", () => {
  let db: DatabaseSync;
  let sessions: SessionsRepo;
  let channels: ChannelHub;
  let recorded: OmniMessage[];
  let recordedCtx: UsageContext[];

  const makeManager = (loader: SessionLoader, errors?: ErrorSink): SessionManager =>
    new SessionManager({
      sessions,
      channels,
      loader,
      recorder: {
        record: async (ctx, msg) => {
          recordedCtx.push(ctx);
          recorded.push(msg);
        },
      },
      ...(errors ? { errors } : {}),
      log: () => {},
    });

  const loaderOf = (session: RuntimeSession): SessionLoader => ({ load: async () => session });

  const capture = (sessionId: string): ChannelEvent[] => {
    const events: ChannelEvent[] = [];
    channels.get(sessionId).subscribe((e) => events.push(e));
    return events;
  };

  const serverEvents = (events: ChannelEvent[]): { type: string; [k: string]: unknown }[] =>
    events
      .filter((e) => e.event === "server_event")
      .map((e) => JSON.parse(e.data) as { type: string });

  beforeEach(() => {
    db = openDatabase(":memory:");
    sessions = new SessionsRepo(db);
    sessions.insert(ROW);
    channels = new ChannelHub();
    recorded = [];
    recordedCtx = [];
  });
  afterEach(() => {
    channels.dispose();
    db.close();
  });

  it("未知 Session → 404", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    const err = await manager.startTask("session-ghost", [userText("x")]).catch((e: unknown) => e);
    expect((err as { status: number }).status).toBe(404);
  });

  it("startTask：先 publish 输入，驱动结束置回 idle 并推送 task_state", async () => {
    sessions.updateApprovalMode("session-1", "allow-all");
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    const events = capture("session-1");
    const { sessionId } = await manager.startTask("session-1", [userText("你好")]);
    expect(sessionId).toBe("session-1");
    await waitFor(() => manager.statusOf("session-1") === "idle" && recorded.length >= 3);

    // The first entry is the input message (visible to other subscribers), followed by task_state: running.
    const first = JSON.parse(events[0]!.data) as { payload: { text: string } };
    expect(first.payload.text).toBe("你好");
    const states = serverEvents(events).filter((e) => e.type === "task_state");
    expect(states.map((s) => s.state)).toEqual(["running", "idle"]);
    // Outputs and events are forwarded one by one and handed to the recorder.
    expect(recordedCtx[0]).toEqual({
      projectId: "p1",
      agentId: "a1",
      sessionId: "session-1",
      modelId: "m1",
      provider: "custom",
    });
  });

  it("消息流里的 LLM / 工具失败经 drive 落库（source=llm / environment，带当前 Session 上下文）", async () => {
    sessions.updateApprovalMode("session-1", "allow-all");
    const captured: ErrorRecordArgs[] = [];
    // core folds LLM / tool failures into the message stream (no throw): a tool
    // failure produces one tool_call_output(failed), an LLM failure produces one
    // request_end(failed) + an abort carrying the real reason.
    const failing: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      async *run(): AsyncGenerator<OmniMessage> {
        yield requestBegin();
        yield toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-1" });
        yield toolCallOutput({
          output: "ls: /nope\n[tool error] exit code 2",
          toolCallId: "tc-1",
          stopReason: "failed",
        });
        yield requestEnd("failed");
        yield abortEvent("llm request error: 500 upstream");
      },
      async *compact(): AsyncGenerator<OmniMessage> {},
    };
    const manager = makeManager(loaderOf(failing), { record: (args) => captured.push(args) });
    await manager.startTask("session-1", [userText("跑")]);
    await waitFor(() => manager.statusOf("session-1") === "idle" && captured.length >= 2);

    expect(captured.map((a) => [a.source, a.code, a.kind])).toEqual([
      ["environment", "tool_failed:exec_command", "expected"], // error fed back to the model; the Agent adjusts on its own
      ["llm", "llm_failed", "unexpected"], // not retryable, requires human intervention
    ]);
    expect(captured[0]!.ctx).toEqual({ projectId: "p1", agentId: "a1", sessionId: "session-1" });
    expect(String(captured[0]!.err)).toContain("[tool error] exit code 2");
    expect(String(captured[1]!.err)).toBe("llm request error: 500 upstream"); // the abort's real reason
  });

  it("互斥：运行中再次 startTask → 409 task_in_progress；compact → 409", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);

    const again = await manager.startTask("session-1", [userText("x")]).catch((e: unknown) => e);
    expect((again as { status: number; code: string }).status).toBe(409);
    expect((again as { code: string }).code).toBe("task_in_progress");
    const compact = await manager.startCompact("session-1").catch((e: unknown) => e);
    expect((compact as { status: number }).status).toBe(409);

    manager.decideApproval("session-1", "tc-1", "allow");
    await waitFor(() => manager.statusOf("session-1") === "idle");
  });

  it("always-ask：登记未决审批并推送 approval_request；决定后继续", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    const events = capture("session-1");
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);

    const requests = serverEvents(events).filter((e) => e.type === "approval_request");
    expect(requests).toHaveLength(1);
    expect(
      (requests[0]!.toolCall as { payload: { tool_call_id: string } }).payload.tool_call_id,
    ).toBe("tc-1");
    expect(manager.pendingApprovals("session-1")).toHaveLength(1);

    expect(manager.decideApproval("session-1", "tc-404", "allow")).toBe(false);
    expect(manager.decideApproval("session-1", "tc-1", "allow")).toBe(true);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(manager.pendingApprovalCount("session-1")).toBe(0);
    const texts = recorded
      .filter((m) => (m.payload as { type?: string }).type === "text")
      .map((m) => (m.payload as { text: string }).text);
    expect(texts).toContain("decision=allow");
  });

  it("deny-all / read-only 自动判定（不转人工）", async () => {
    sessions.updateApprovalMode("session-1", "deny-all");
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(
      recorded.some(
        (m) =>
          (m.payload as { type?: string; decision?: string }).type === "approval_decision" &&
          (m.payload as { decision: string }).decision === "deny",
      ),
    ).toBe(true);

    // read-only: read-only tools are auto-approved.
    recorded = [];
    sessions.updateApprovalMode("session-1", "read-only");
    const manager2 = makeManager(loaderOf(approvalFakeSession("session-1", "read_tool")));
    await manager2.startTask("session-1", [userText("go")]);
    await waitFor(() => manager2.statusOf("session-1") === "idle");
    expect(recorded.some((m) => (m.payload as { text?: string }).text === "decision=allow")).toBe(
      true,
    );
  });

  it("子会话（origin）登记：session_meta 落库，标题交模型据子会话自己的对话生成", async () => {
    const fake: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      async *run() {
        // The parent-level run_subagent call (no origin): its prompt becomes the sub-session title.
        yield toolCall({
          name: "run_subagent",
          arguments: JSON.stringify({ prompt: "研究一下这个问题的背景资料" }),
          toolCallId: "sub-1",
        });
        const hop = "child-1";
        yield withOrigin(
          sessionMeta({
            session_id: "child-1",
            model_id: "m-child",
            provider: "custom",
            model_context_window: 1000,
            system_prompt: "sys",
            tools: [],
            thinking_level: "default",
            agent_state: "/root/p1/child_agent/agent_state",
            workspace: "/tmp/w-child",
          }),
          hop,
        );
        yield withOrigin(assistantText("child done"), hop);
        yield assistantText("done");
      },
      async *compact() {},
    };
    const notified: Array<{ ctx: UsageContext; req: TitleRequest }> = [];
    const manager = new SessionManager({
      sessions,
      channels,
      loader: loaderOf(fake),
      recorder: { record: async () => {} },
      titles: {
        maybeGenerate: (ctx, _session, req) => notified.push({ ctx, req }),
      },
      log: () => {},
    });
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    const child = sessions.findById("child-1");
    expect(child).not.toBeNull();
    expect(child?.agentId).toBe("child_agent");
    expect(child?.modelId).toBe("m-child");
    expect(child?.workspace).toBe("/tmp/w-child");
    // Title left blank: produced by the title generator from the sub-session's own conversation (falls back to the prompt's first line on failure).
    expect(child?.title).toBeNull();

    await waitFor(() => notified.length === 2);
    const childTitle = notified.find((n) => n.ctx.sessionId === "child-1");
    expect(childTitle).toBeTruthy();
    // Explicit material override for the sub-session: user material = the prompt that spawned it; assistant material = the sub-session's **own** model output.
    expect(childTitle!.req.material).toEqual({
      userText: "研究一下这个问题的背景资料",
      assistantText: "child done",
    });
    expect(childTitle!.req.fallbackText).toBe("研究一下这个问题的背景资料");
    // Session/Agent record the sub-session, but modelId records the parent — the request runs on the parent's bare LLM.
    expect(childTitle!.ctx).toMatchObject({ agentId: "child_agent", modelId: "m1" });
    // The sub-session has no SSE channel of its own: title events are delivered over the parent session's channel.
    expect(childTitle!.req.notifyOn).toBe("session-1");
  });

  it("审批模式即改即生效：运行中 PATCH 后下一次决策用新模式", async () => {
    // A fake Session that requests approval twice.
    const fake: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      async *run(_input, opts) {
        const tc1 = toolCall({ name: "t1", arguments: "{}", toolCallId: "tc-1" });
        yield tc1;
        yield approvalDecision(await opts.approve(tc1), "tc-1");
        const tc2 = toolCall({ name: "t2", arguments: "{}", toolCallId: "tc-2" });
        yield tc2;
        yield approvalDecision(await opts.approve(tc2), "tc-2");
      },
      async *compact() {},
    };
    const manager = makeManager(loaderOf(fake));
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    // Switch to allow-all while the first request is pending human review: the second no longer needs one.
    sessions.updateApprovalMode("session-1", "allow-all");
    manager.decideApproval("session-1", "tc-1", "deny");
    await waitFor(() => manager.statusOf("session-1") === "idle");
    const decisions = recorded
      .filter((m) => (m.payload as { type?: string }).type === "approval_decision")
      .map((m) => (m.payload as { decision: string }).decision);
    expect(decisions).toEqual(["deny", "allow"]);
    expect(manager.pendingApprovalCount("session-1")).toBe(0);
  });

  it("abort：未决审批收敛为 deny 再触发 AbortSignal", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    expect(manager.abortTask("session-1")).toBe(false); // no Task in progress → no-op
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    expect(manager.abortTask("session-1")).toBe(true);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    const payloads = recorded.map((m) => m.payload as { type?: string; decision?: string });
    expect(payloads.some((p) => p.type === "approval_decision" && p.decision === "deny")).toBe(
      true,
    );
    expect(payloads.some((p) => p.type === "abort")).toBe(true);
  });

  it("beginSessionDeletion：中断活跃运行、清出活跃表并标记删除中（新任务 409），end 后恢复", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    expect(manager.beginSessionDeletion("session-1")).toEqual([]); // no active entry
    // While deletion is in progress: a new Task is rejected with 409 (prevents resurrection).
    const rejected = await manager.startTask("session-1", [userText("x")]).catch((e: unknown) => e);
    expect((rejected as { status?: number }).status).toBe(409);
    manager.endSessionDeletion("session-1");
    // Runs normally once the deletion flag is cleared.
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    const runnings = manager.beginSessionDeletion("session-1");
    expect(runnings.length).toBe(1);
    await Promise.allSettled(runnings);
    expect(manager.statusOf("session-1")).toBe("idle"); // entry has been removed
    manager.endSessionDeletion("session-1");
  });

  it("自愈：loader 返回新 session_id 时更新索引主键并返回当前实际 id", async () => {
    sessions.updateApprovalMode("session-1", "allow-all");
    const manager = makeManager(loaderOf(approvalFakeSession("session-2-healed")));
    const { sessionId } = await manager.startTask("session-1", [userText("go")]);
    expect(sessionId).toBe("session-2-healed");
    expect(sessions.findById("session-1")).toBeNull();
    expect(sessions.findById("session-2-healed")).not.toBeNull();
    await waitFor(() => manager.statusOf("session-2-healed") === "idle");
    // Usage is attributed under the new id.
    expect(recordedCtx[0]!.sessionId).toBe("session-2-healed");
  });

  it("通道被回收重建后 drive 仍发到当前通道（每次 publish 前重新 get）", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);

    // No subscribers, no publish while waiting for approval: simulate idle sweeping removing the old channel.
    channels.sweep(Date.now() + 60 * 60 * 1000);
    // Reconnect: hub.get creates a brand-new channel, and we subscribe to it.
    const events = capture("session-1");
    manager.decideApproval("session-1", "tc-1", "allow");
    await waitFor(() => manager.statusOf("session-1") === "idle");

    // The remaining output and task_state after approval must land on the new channel (the old reference should already be stale).
    const texts = events
      .filter((e) => e.event === undefined)
      .map((e) => (JSON.parse(e.data) as { payload: { type?: string; text?: string } }).payload)
      .filter((p) => p.type === "text")
      .map((p) => p.text);
    expect(texts).toContain("decision=allow");
    const states = serverEvents(events).filter((e) => e.type === "task_state");
    expect(states.map((s) => s.state)).toContain("idle");
  });

  it("abortProject：返回进行中的驱动 Promise，等待后收尾完成", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    expect(manager.abortProject("p1")).toEqual([]); // no active runs → empty array
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);

    const runnings = manager.abortProject("p1");
    expect(runnings).toHaveLength(1);
    await Promise.allSettled(runnings);
    // Wrap-up complete: the abort cleanup (abort event) has been written, and the entry has been removed from the active table.
    expect(recorded.some((m) => (m.payload as { type?: string }).type === "abort")).toBe(true);
    expect(manager.statusOf("session-1")).toBe("idle");
  });

  it("loader 抛 HttpError（如 workspace_missing 409）→ 原样透传，不被重复包装", async () => {
    const loader: SessionLoader = {
      load: async () => {
        throw new HttpError(409, "workspace_missing", "Workspace 已不存在。");
      },
    };
    const manager = makeManager(loader);
    const err = await manager.startTask("session-1", [userText("x")]).catch((e: unknown) => e);
    expect((err as { status: number; code: string }).status).toBe(409);
    expect((err as { code: string }).code).toBe("workspace_missing");
  });

  it("shutdown 置位后拒收新任务（503 shutting_down）", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    await manager.shutdown();
    const err = await manager.startTask("session-1", [userText("x")]).catch((e: unknown) => e);
    expect((err as { status: number; code: string }).status).toBe(503);
    expect((err as { code: string }).code).toBe("shutting_down");
    const compactErr = await manager.startCompact("session-1").catch((e: unknown) => e);
    expect((compactErr as { status: number }).status).toBe(503);
  });

  it("sweepIdle：空闲超时的 entry 被淘汰（下次访问经 loader 重新装载）", async () => {
    let loads = 0;
    const loader: SessionLoader = {
      load: async () => {
        loads++;
        return approvalFakeSession("session-1");
      },
    };
    const manager = makeManager(loader);
    manager.adopt(ROW, approvalFakeSession("session-1"));
    // Not evicted before timeout: startTask reuses the active-table entry, bypassing the loader.
    manager.sweepIdle(Date.now() + 1000, 30 * 60 * 1000);
    sessions.updateApprovalMode("session-1", "allow-all");
    await manager.startTask("session-1", [userText("a")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(0);

    // Evicted after timeout: once the entry is released, the next startTask reloads it.
    manager.sweepIdle(Date.now() + 31 * 60 * 1000, 30 * 60 * 1000);
    await manager.startTask("session-1", [userText("b")]);
    await waitFor(() => manager.statusOf("session-1") === "idle");
    expect(loads).toBe(1);
  });

  it("sweepIdle：运行中 / 有未决审批的 entry 不淘汰", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    await manager.startTask("session-1", [userText("go")]);
    await waitFor(() => manager.pendingApprovalCount("session-1") === 1);
    manager.sweepIdle(Date.now() + 24 * 60 * 60 * 1000, 30 * 60 * 1000);
    // The entry is still there: the approval can be decided and wraps up normally.
    expect(manager.statusOf("session-1")).toBe("running");
    expect(manager.decideApproval("session-1", "tc-1", "allow")).toBe(true);
    await waitFor(() => manager.statusOf("session-1") === "idle");
  });

  it("compact：置 compacting、输出进通道、结束回 idle", async () => {
    const manager = makeManager(loaderOf(approvalFakeSession("session-1")));
    const events = capture("session-1");
    await manager.startCompact("session-1");
    await waitFor(() => manager.statusOf("session-1") === "idle" && recorded.length >= 2);
    const states = serverEvents(events).filter((e) => e.type === "task_state");
    expect(states.map((s) => s.state)).toEqual(["compacting", "idle"]);
    expect(recorded.map((m) => (m.payload as { type: string }).type)).toEqual([
      "compaction_begin",
      "compaction_end",
    ]);
  });

  it("Task 完成后通知标题生成：兜底素材取用户 text、生成素材由 Session 自采；压缩不通知", async () => {
    const notified: { ctx: UsageContext; session: unknown; req: TitleRequest }[] = [];
    const plainSession: RuntimeSession = {
      sessionId: "session-1",
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      async *run() {
        yield thinkingMessage("思考中");
        yield assistantText("答案A");
        yield withOrigin(assistantText("子会话文本"), "session-sub");
        yield assistantText("答案B");
      },
      async *compact() {
        yield compactionBegin({ reason: "manual", mode: "summarize", context: 1, turns: 1 });
        yield compactionEnd({ reason: "manual", mode: "summarize", status: "completed" });
      },
    };
    const manager = new SessionManager({
      sessions,
      channels,
      loader: loaderOf(plainSession),
      recorder: { record: async () => {} },
      titles: {
        maybeGenerate: (ctx, session, req) => notified.push({ ctx, session, req }),
      },
      log: () => {},
    });

    await manager.startTask("session-1", [userText("问题1"), userText("问题2")]);
    await waitFor(() => notified.length === 1);
    expect(notified[0]!.req.fallbackText).toBe("问题1\n问题2");
    // No material override for the main session: material is gathered by the core Session during run.
    expect(notified[0]!.req.material).toBeUndefined();
    expect(notified[0]!.session).toBe(plainSession);
    expect(notified[0]!.ctx).toMatchObject({
      projectId: "p1",
      agentId: "a1",
      sessionId: "session-1",
      modelId: "m1",
      provider: "custom",
    });

    await manager.startCompact("session-1");
    await waitFor(() => manager.statusOf("session-1") === "idle");
    await new Promise((r) => setTimeout(r, 10));
    expect(notified.length).toBe(1);
  });
});
