/**
 * stream-controller.ts unit tests: buffer/replay phase machine, task_state as the
 * authoritative state while streaming (history-closing decision), the generation guard
 * against rebuild re-entrancy during replay, resync rebuild (clears the pending table +
 * keeps localDecisions), approval re-delivery keyed by origin composite key + missing
 * card backfill, and history load failure/retry.
 */
import { describe, expect, it } from "vitest";
import {
  approvalDecision,
  assistantText,
  tokenUsage,
  toolCall,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core/omnimessage";
import type { OmniMessage, TokenCounts } from "@prismshadow/penguin-core/omnimessage";
import type { ServerEvent, SessionStatus } from "@prismshadow/penguin-server/api";
import { createStreamController } from "../src/lib/omni/stream-controller";
import type { StreamController } from "../src/lib/omni/stream-controller";
import { approvalKey, findToolCard } from "../src/lib/omni/stream-model";
import type { ToolCallItem } from "../src/lib/omni/stream-model";

/** Override a message timestamp (constructor defaults to the current time). */
function at<M extends OmniMessage>(msg: M, ts: string): M {
  return { ...msg, timestamp: ts };
}

function counts(total: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: 0, total };
}

/** Flush microtasks/macrotasks: let async loads started inside rebuild finish. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Harness {
  controller: StreamController;
  states: SessionStatus[];
  errors: Array<string | null>;
  loadings: boolean[];
  loadCalls: () => number;
  resolveLoad: (messages: OmniMessage[]) => void;
  rejectLoad: (err: Error) => void;
}

function createHarness(): Harness {
  const pendingLoads: Array<{
    resolve: (m: OmniMessage[]) => void;
    reject: (e: unknown) => void;
  }> = [];
  const states: SessionStatus[] = [];
  const errors: Array<string | null> = [];
  const loadings: boolean[] = [];
  let calls = 0;
  const controller = createStreamController({
    loadMessages: () =>
      new Promise<OmniMessage[]>((resolve, reject) => {
        calls += 1;
        pendingLoads.push({ resolve, reject });
      }),
    onTaskState: (s) => states.push(s),
    onLoading: (l) => loadings.push(l),
    onError: (e) => errors.push(e),
    onModelChange: () => {},
    onPendingChange: () => {},
    now: () => 1_000_000,
  });
  return {
    controller,
    states,
    errors,
    loadings,
    loadCalls: () => calls,
    resolveLoad: (messages) => pendingLoads.shift()!.resolve(messages),
    rejectLoad: (err) => pendingLoads.shift()!.reject(err),
  };
}

const HISTORY_TASK: OmniMessage[] = [
  at(userText("问题"), "2026-07-05T00:00:00.000Z"),
  at(assistantText("回答"), "2026-07-05T00:00:03.000Z"),
  at(tokenUsage(counts(1000), counts(1000)), "2026-07-05T00:00:05.000Z"),
];

describe("流中 task_state 为权威运行状态（历史收口判定）", () => {
  it("订阅快照 idle：历史收口，产出最后一个 Task 的统计行", async () => {
    const h = createHarness();
    const p = h.controller.load();
    // Connection comes first: the snapshot arrives before history, so it's buffered.
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.resolveLoad(HISTORY_TASK);
    await p;
    expect(h.states).toContain("idle");
    expect(h.controller.model.items.map((i) => i.kind)).toEqual([
      "user_text",
      "assistant_text",
      "task_stats",
    ]);
  });

  it("订阅快照 running：不提前收口；随后的 idle 事件才收口", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "running" });
    h.resolveLoad(HISTORY_TASK);
    await p;
    expect(h.controller.model.items.some((i) => i.kind === "task_stats")).toBe(false);
    // The real flip event arrives (live phase) → closes out.
    h.controller.handleServer({ type: "task_state", state: "idle" });
    expect(h.controller.model.items.some((i) => i.kind === "task_stats")).toBe(true);
  });

  it("快照未到时不按列表快照收口；迟到的 idle 快照到达后完成同等收口", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad(HISTORY_TASK);
    await p;
    // No in-stream state at all → doesn't close out (list snapshot isn't trusted).
    expect(h.controller.model.items.some((i) => i.kind === "task_stats")).toBe(false);
    h.controller.handleServer({ type: "task_state", state: "idle" });
    expect(h.controller.model.items.some((i) => i.kind === "task_stats")).toBe(true);
  });

  it("缓冲期间的 task_state 即时上报输入区（不等历史回放）", async () => {
    const h = createHarness();
    void h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "running" });
    // History hasn't returned yet, but state is already reported.
    expect(h.states).toEqual(["running"]);
  });
});

describe("审批补发（origin 组合键 + 缺卡补建）", () => {
  it("子会话审批补发：找不到工具卡时用 toolCall 补建嵌套卡，重复补发不重复建卡", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad([]);
    await p;
    const tc = withOrigin(
      toolCall({ name: "exec_command", arguments: '{"cmd":"rm -rf x"}', toolCallId: "t1" }),
      "c1",
    );
    const ev: ServerEvent = { type: "approval_request", toolCall: tc, origin: ["c1"] };
    h.controller.handleServer(ev);
    // The pending table is keyed by origin composite key.
    expect(h.controller.pendingApprovals.has(approvalKey(["c1"], "t1"))).toBe(true);
    expect(h.controller.pendingApprovals.has(approvalKey(undefined, "t1"))).toBe(false);
    // The nested card is backfilled (child-session messages aren't in the parent Trace;
    // without this mechanism, the approval button has nowhere to render).
    const card = findToolCard(h.controller.model, ["c1"], "t1");
    expect(card).not.toBeNull();
    expect((card as ToolCallItem).name).toBe("exec_command");
    // Repeated re-delivery (reconnect) doesn't create a duplicate card.
    h.controller.handleServer(ev);
    const sub = h.controller.model.subagents.get("c1")!;
    expect(sub.items.filter((i) => i.kind === "tool_call")).toHaveLength(1);
  });

  it("主会话审批补发：历史已有工具卡则不重复建卡", async () => {
    const h = createHarness();
    const p = h.controller.load();
    const tc = toolCall({ name: "write_file", arguments: "{}", toolCallId: "t2" });
    h.resolveLoad([at(tc, "2026-07-05T00:00:00.000Z")]);
    await p;
    h.controller.handleServer({ type: "approval_request", toolCall: tc });
    expect(h.controller.model.items.filter((i) => i.kind === "tool_call")).toHaveLength(1);
    expect(h.controller.pendingApprovals.has(approvalKey(undefined, "t2"))).toBe(true);
  });

  it("approval_decision 事件按 origin 组合键移除对应未决项", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad([]);
    await p;
    const tc = withOrigin(toolCall({ name: "x", arguments: "{}", toolCallId: "t1" }), "c1");
    h.controller.handleServer({ type: "approval_request", toolCall: tc, origin: ["c1"] });
    expect(h.controller.pendingApprovals.size).toBe(1);
    h.controller.handleOmni(withOrigin(approvalDecision("allow", "t1"), "c1"));
    expect(h.controller.pendingApprovals.size).toBe(0);
  });
});

describe("resync 重建", () => {
  it("重建清空未决审批表；服务端随后补发的仍未决请求天然重建（#28）", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad([]);
    await p;
    const tc = toolCall({ name: "x", arguments: "{}", toolCallId: "t1" });
    h.controller.handleServer({ type: "approval_request", toolCall: tc });
    expect(h.controller.pendingApprovals.size).toBe(1);

    h.controller.handleServer({ type: "resync_required" });
    // Approvals already decided during the disconnect leave no residual button.
    expect(h.controller.pendingApprovals.size).toBe(0);
    // The server re-delivers the still-pending request on the same connection
    // (buffered during rebuild, rebuilt after replay).
    h.controller.handleServer({ type: "approval_request", toolCall: tc });
    h.resolveLoad([at(tc, "2026-07-05T00:00:00.000Z")]);
    await flush();
    expect(h.controller.pendingApprovals.size).toBe(1);
  });

  it("重建保留 localDecisions：本端点过的审批重放后仍标「人工」（#22）", async () => {
    const h = createHarness();
    const p = h.controller.load();
    const tc = at(
      toolCall({ name: "x", arguments: "{}", toolCallId: "t1" }),
      "2026-07-05T00:00:00.000Z",
    );
    h.resolveLoad([tc]);
    await p;
    h.controller.markLocalDecision("t1");

    h.controller.handleServer({ type: "resync_required" });
    h.resolveLoad([tc, at(approvalDecision("allow", "t1"), "2026-07-05T00:00:01.000Z")]);
    await flush();
    const card = h.controller.model.items.find((i) => i.kind === "tool_call") as ToolCallItem;
    expect(card.decision).toBe("allow");
    expect(card.decisionSource).toBe("manual");
  });

  it("回放中触发 resync：本轮作废、剩余缓冲转入新一轮，不乱序不重复（#21/#26）", async () => {
    const h = createHarness();
    const p = h.controller.load();
    // Buffer: old event A → resync_required → task_state:idle (server re-delivery order).
    h.controller.handleOmni(at(assistantText("旧事件 A"), "2026-07-05T00:00:01.000Z"));
    h.controller.handleServer({ type: "resync_required" });
    h.controller.handleServer({ type: "task_state", state: "idle" });
    // First round of history returns: replaying up to resync_required invalidates this round.
    h.resolveLoad([at(userText("问题"), "2026-07-05T00:00:00.000Z")]);
    await p;
    expect(h.loadCalls()).toBe(2);
    // The old replay must not reset phase back to live: events arriving during rebuild
    // should still be buffered, not fed to the new model.
    const live = at(assistantText("重建期间的输出"), "2026-07-05T00:00:02.000Z");
    h.controller.handleOmni(live);
    expect(h.controller.model.items).toHaveLength(0);
    // Second round of history (authoritative) returns: the transferred task_state and
    // buffered events replay in order.
    h.resolveLoad([
      at(userText("问题"), "2026-07-05T00:00:00.000Z"),
      at(tokenUsage(counts(500), counts(500)), "2026-07-05T00:00:01.500Z"),
    ]);
    await flush();
    expect(h.controller.model.items.map((i) => i.kind)).toEqual([
      "user_text",
      "task_stats",
      "assistant_text",
    ]);
    expect(h.controller.model.items.filter((i) => i.kind === "user_text")).toHaveLength(1);
  });
});

describe("历史加载失败与重试（#6）", () => {
  it("失败暴露错误并停止加载；重试保留缓冲（快照与初始事件不丢）", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.controller.handleServer({ type: "task_state", state: "idle" });
    h.rejectLoad(new Error("网络错误"));
    await p;
    expect(h.errors[h.errors.length - 1]).toBe("网络错误");
    expect(h.loadings[h.loadings.length - 1]).toBe(false);

    const retryP = h.controller.retry();
    h.resolveLoad(HISTORY_TASK);
    await retryP;
    expect(h.errors[h.errors.length - 1]).toBeNull();
    // The idle snapshot in the buffer isn't lost: the history-closing stats row is produced.
    expect(h.controller.model.items.some((i) => i.kind === "task_stats")).toBe(true);
  });

  it("未失败时 retry 是 no-op（不会重复回放历史）", async () => {
    const h = createHarness();
    const p = h.controller.load();
    h.resolveLoad(HISTORY_TASK);
    await p;
    await h.controller.retry();
    expect(h.loadCalls()).toBe(1);
  });
});
