/**
 * stream-model.ts unit tests: partial aggregation, full-message
 * convergence/replacement, orphan delta handling, overlap dedup, origin nested routing,
 * approval/abort/compaction events, Task segmentation and stats triggering.
 */
import { describe, expect, it } from "vitest";
import {
  abortEvent,
  approvalDecision,
  assistantText,
  compactionBegin,
  compactionEnd,
  imageUrlMessage,
  partialText,
  partialThinking,
  partialToolCall,
  partialToolCallOutput,
  requestBegin,
  requestEnd,
  sessionMeta,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core/omnimessage";
import type {
  OmniMessage,
  SessionMetaPayload,
  TokenCounts,
} from "@prismshadow/penguin-core/omnimessage";
import {
  approvalKey,
  buildDedupIndex,
  createStreamModel,
  discardFragmentFor,
  finalizeHistory,
  findToolCard,
  isDuplicate,
  notifyTaskIdle,
  pushMessage,
  pushMessages,
  registerLocalDecision,
} from "../src/lib/omni/stream-model";
import type {
  AssistantTextItem,
  CompactionItem,
  ReconnectItem,
  StreamModel,
  SubagentItem,
  TaskStatsItem,
  ThinkingItem,
  ToolCallItem,
  UserTextItem,
} from "../src/lib/omni/stream-model";

/** Override a message timestamp (constructor defaults to the current time). */
function at<M extends OmniMessage>(msg: M, ts: string): M {
  return { ...msg, timestamp: ts };
}

function counts(total: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: 0, total };
}

/** Output-only counts (for output-TPS timing cases: request.output = total = n). */
function out(n: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: n, total: n };
}

function meta(sessionId: string): OmniMessage<SessionMetaPayload> {
  return sessionMeta({
    session_id: sessionId,
    model_id: "m",
    provider: "custom",
    model_context_window: 200000,
    system_prompt: "",
    tools: [],
    thinking_level: "default",
    agent_state: "/a",
    workspace: "/w",
  });
}

function items(model: StreamModel) {
  return model.items;
}

describe("partial 聚合与完整消息收敛", () => {
  it("partial_text start/delta/stop 累积为一个流式项，完整消息替换内容", () => {
    const m = createStreamModel();
    pushMessage(m, partialText("start"));
    pushMessage(m, partialText("delta", "Hel"));
    pushMessage(m, partialText("delta", "lo"));
    expect(items(m)).toHaveLength(1);
    const item = items(m)[0] as AssistantTextItem;
    expect(item.kind).toBe("assistant_text");
    expect(item.text).toBe("Hello");
    expect(item.streaming).toBe(true);

    pushMessage(m, partialText("stop"));
    expect(item.streaming).toBe(false);

    // The full message replaces the fragment content (deliberately different here to prove replacement).
    pushMessage(m, assistantText("Hello!"));
    expect(items(m)).toHaveLength(1);
    expect(item.text).toBe("Hello!");
  });

  it("partial_thinking 同理，stop_reason 记录在项上", () => {
    const m = createStreamModel();
    pushMessage(m, partialThinking("start"));
    pushMessage(m, partialThinking("delta", "思考中"));
    pushMessage(m, partialThinking("stop", "", "aborted"));
    const item = items(m)[0] as ThinkingItem;
    expect(item.kind).toBe("thinking");
    expect(item.thinking).toBe("思考中");
    expect(item.stopReason).toBe("aborted");
    pushMessage(m, thinkingMessage("思考中（完整）", "aborted"));
    expect(items(m)).toHaveLength(1);
    expect(item.thinking).toBe("思考中（完整）");
  });

  it("孤儿 delta/stop（未见 start，中途加入）被忽略，随后的完整消息直接追加", () => {
    const m = createStreamModel();
    pushMessage(m, partialText("delta", "半截"));
    pushMessage(m, partialText("stop"));
    expect(items(m)).toHaveLength(0);
    pushMessage(m, assistantText("完整文本"));
    expect(items(m)).toHaveLength(1);
    expect((items(m)[0] as AssistantTextItem).text).toBe("完整文本");
  });

  it("工具卡：partial_tool_call 按 tool_call_id 归属，完整消息替换参数", () => {
    const m = createStreamModel();
    pushMessage(m, partialToolCall({ eventType: "start", name: "exec_command", toolCallId: "t1" }));
    pushMessage(
      m,
      partialToolCall({ eventType: "delta", name: "", arguments: '{"cmd":"ls', toolCallId: "t1" }),
    );
    pushMessage(m, partialToolCall({ eventType: "stop", name: "", toolCallId: "t1" }));
    const card = items(m)[0] as ToolCallItem;
    expect(card.kind).toBe("tool_call");
    expect(card.name).toBe("exec_command");
    expect(card.argumentsText).toBe('{"cmd":"ls');
    expect(card.callStreaming).toBe(false);

    pushMessage(m, toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "t1" }));
    expect(items(m)).toHaveLength(1);
    expect(card.argumentsText).toBe('{"cmd":"ls"}');
    expect(card.callComplete).toBe(true);

    // Output is appended while streaming; the full output replaces it.
    pushMessage(m, partialToolCallOutput({ eventType: "start", toolCallId: "t1" }));
    pushMessage(
      m,
      partialToolCallOutput({ eventType: "delta", output: "a.txt\n", toolCallId: "t1" }),
    );
    expect(card.output).toBe("a.txt\n");
    expect(card.outputStreaming).toBe(true);
    pushMessage(m, partialToolCallOutput({ eventType: "stop", toolCallId: "t1" }));
    pushMessage(m, toolCallOutput({ output: "a.txt\nb.txt\n", toolCallId: "t1" }));
    expect(card.output).toBe("a.txt\nb.txt\n");
    expect(card.outputComplete).toBe(true);
  });

  it("完整 tool_call 先到（历史）时，迟到的流式副本被忽略", () => {
    const m = createStreamModel();
    pushMessage(m, toolCall({ name: "read_file", arguments: '{"path":"x"}', toolCallId: "t2" }));
    pushMessage(m, partialToolCall({ eventType: "start", name: "read_file", toolCallId: "t2" }));
    pushMessage(
      m,
      partialToolCall({ eventType: "delta", name: "", arguments: "重复", toolCallId: "t2" }),
    );
    const card = items(m)[0] as ToolCallItem;
    expect(items(m)).toHaveLength(1);
    expect(card.argumentsText).toBe('{"path":"x"}');
  });

  it("无调用卡的孤儿输出 delta 被忽略，完整输出补建卡片", () => {
    const m = createStreamModel();
    pushMessage(m, partialToolCallOutput({ eventType: "delta", output: "孤儿", toolCallId: "t3" }));
    expect(items(m)).toHaveLength(0);
    pushMessage(m, toolCallOutput({ output: "完整输出", toolCallId: "t3" }));
    expect(items(m)).toHaveLength(1);
    expect((items(m)[0] as ToolCallItem).output).toBe("完整输出");
  });

  it("工具输出图片经流式 delta 整体到达即写入工具卡，完整消息再次收敛", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const m = createStreamModel();
    pushMessage(
      m,
      toolCall({ name: "read_image", arguments: '{"source":"a.png"}', toolCallId: "t4" }),
    );
    const card = items(m)[0] as ToolCallItem;
    expect(card.images).toBeUndefined();
    // Streaming: start → text delta → image delta (a single delta carries the whole image) → stop.
    pushMessage(m, partialToolCallOutput({ eventType: "start", toolCallId: "t4" }));
    pushMessage(
      m,
      partialToolCallOutput({ eventType: "delta", output: "image/png, 4 B", toolCallId: "t4" }),
    );
    pushMessage(
      m,
      partialToolCallOutput({ eventType: "delta", toolCallId: "t4", images: [dataUrl] }),
    );
    // The image becomes visible as soon as the streaming delta arrives, without waiting for the full message.
    expect(card.images).toEqual([dataUrl]);
    pushMessage(m, partialToolCallOutput({ eventType: "stop", toolCallId: "t4" }));
    // Full message converges: text is replaced, image is overwritten with the same value.
    pushMessage(
      m,
      toolCallOutput({ output: "image/png, 4 B", toolCallId: "t4", images: [dataUrl] }),
    );
    expect(card.output).toBe("image/png, 4 B");
    expect(card.images).toEqual([dataUrl]);
    expect(card.outputComplete).toBe(true);
  });
});

describe("审批与事件", () => {
  it("approval_decision 标注对应工具卡；本端登记的标 manual，其余 remote", () => {
    const m = createStreamModel();
    pushMessage(m, toolCall({ name: "a", arguments: "{}", toolCallId: "t1" }));
    pushMessage(m, toolCall({ name: "b", arguments: "{}", toolCallId: "t2" }));
    registerLocalDecision(m, "t1");
    pushMessage(m, approvalDecision("allow", "t1"));
    pushMessage(m, approvalDecision("deny", "t2"));
    const [c1, c2] = items(m) as [ToolCallItem, ToolCallItem];
    expect(c1.decision).toBe("allow");
    expect(c1.decisionSource).toBe("manual");
    expect(c2.decision).toBe("deny");
    expect(c2.decisionSource).toBe("remote");
  });

  it("先于卡片到达的审批决定在卡片创建时回填", () => {
    const m = createStreamModel();
    pushMessage(m, approvalDecision("allow", "t9"));
    pushMessage(m, toolCall({ name: "x", arguments: "{}", toolCallId: "t9" }));
    expect((items(m)[0] as ToolCallItem).decision).toBe("allow");
  });

  it("abort 事件产出中断标记项", () => {
    const m = createStreamModel();
    pushMessage(m, abortEvent("用户中断"));
    expect(items(m)[0]).toMatchObject({ kind: "abort", reason: "用户中断" });
  });

  it("compaction begin/end 产出横幅项，完成行带 tokens 口径", () => {
    const m = createStreamModel();
    pushMessage(m, tokenUsage(counts(1000), counts(1000)));
    pushMessage(
      m,
      compactionBegin({ reason: "manual", mode: "summarize", context: 1000, turns: 3 }),
    );
    const banner = items(m)[0] as CompactionItem;
    expect(banner.kind).toBe("compaction");
    expect(banner.running).toBe(true);
    // Compaction request's own usage.
    pushMessage(m, tokenUsage(counts(1300), counts(300)));
    pushMessage(m, compactionEnd({ reason: "manual", mode: "summarize", status: "completed" }));
    expect(banner.running).toBe(false);
    expect(banner.status).toBe("completed");
    // The banner doesn't show Token: that usage already lands in this round's stats row
    // and cost (see the tokensDelta assertion below).
    expect(banner).not.toHaveProperty("tokens");
  });

  it("request_begin/end（正常终态）与主会话 session_meta 不渲染", () => {
    const m = createStreamModel();
    pushMessage(m, meta("session-x"));
    pushMessage(m, requestBegin());
    pushMessage(m, requestEnd("completed"));
    expect(items(m)).toHaveLength(0);
  });

  it("request_end 终态 timeout/malformed 产出重试提示项（含第几次）；request_begin 置为已重发", () => {
    const m = createStreamModel();
    pushMessage(m, requestBegin());
    pushMessage(m, requestEnd("malformed"));
    const retry = items(m)[0] as ReconnectItem;
    expect(retry).toMatchObject({
      kind: "reconnect",
      status: "malformed",
      attempt: 1,
      retrying: false,
    });
    // Retry request sent: the notice is marked as retrying.
    pushMessage(m, requestBegin());
    expect(retry.retrying).toBe(true);
    // Retry fails again: a second notice, attempt count increments.
    pushMessage(m, requestEnd("timeout"));
    const retry2 = items(m)[1] as ReconnectItem;
    expect(retry2).toMatchObject({ kind: "reconnect", status: "timeout", attempt: 2 });
    // Retry succeeds: no new entry, the consecutive-failure count resets to 0 — the next round's failure starts back at 1.
    pushMessage(m, requestBegin());
    pushMessage(m, requestEnd("completed"));
    expect(items(m)).toHaveLength(2);
    pushMessage(m, requestBegin());
    pushMessage(m, requestEnd("timeout"));
    expect((items(m)[2] as ReconnectItem).attempt).toBe(1);
  });

  it("重试耗尽：abort 到达把等待中的重试提示置为 gaveUp，连续失败计数清零", () => {
    const m = createStreamModel();
    pushMessage(m, requestBegin());
    pushMessage(m, requestEnd("timeout"));
    pushMessage(m, abortEvent("reconnect failed after 2 retries"));
    const retry = items(m)[0] as ReconnectItem;
    expect(retry).toMatchObject({
      kind: "reconnect",
      status: "timeout",
      retrying: false,
      gaveUp: true,
    });
    expect(items(m)[1]).toMatchObject({ kind: "abort" });
    // A new failure in the next run starts back at 1; a gaveUp notice isn't revived by request_begin.
    pushMessage(m, requestBegin());
    expect(retry.retrying).toBe(false);
    pushMessage(m, requestEnd("malformed"));
    expect((items(m)[2] as ReconnectItem).attempt).toBe(1);
  });

  it("新 Task 开始收口上一 Task 悬挂的重试提示（服务端死在退避窗、Trace 无 abort）", () => {
    const m = createStreamModel();
    pushMessage(m, userText("go"));
    pushMessage(m, requestBegin());
    pushMessage(m, requestEnd("timeout")); // dangling at the tail: no abort, no retry begin
    const dangling = items(m).find((i) => i.kind === "reconnect") as ReconnectItem;
    expect(dangling.retrying).toBe(false);
    // New Task: the dangling item is marked gaveUp (the new request isn't its retry), count resets.
    pushMessage(m, userText("next"));
    pushMessage(m, requestBegin());
    expect(dangling.gaveUp).toBe(true);
    expect(dangling.retrying).toBe(false);
    pushMessage(m, requestEnd("timeout"));
    const fresh = items(m).filter((i) => i.kind === "reconnect")[1] as ReconnectItem;
    expect(fresh.attempt).toBe(1);
  });

  it("非 completed 收口的 tool_call（malformed 闭合）到达即收卡，不再显示执行中", () => {
    const m = createStreamModel();
    pushMessage(
      m,
      toolCall({
        name: "exec_command",
        arguments: '{"cmd": "ec',
        toolCallId: "tc-broken",
        stopReason: "malformed",
      }),
    );
    const card = findToolCard(m, undefined, "tc-broken")!;
    expect(card.callComplete).toBe(true);
    // This call was never dispatched for execution and will never have output: close it
    // immediately with the close reason, so execution timing doesn't spin idle.
    expect(card.outputComplete).toBe(true);
    expect(card.outputStopReason).toBe("malformed");
  });

  it("压缩区间内的 request 事件不产出重试提示（历史重建，压缩过程只暴露事件对）", () => {
    const m = createStreamModel();
    pushMessage(m, compactionBegin({ reason: "context", mode: "summarize", context: 1, turns: 1 }));
    pushMessage(m, requestBegin());
    pushMessage(m, requestEnd("timeout"));
    pushMessage(m, compactionEnd({ reason: "context", mode: "summarize", status: "completed" }));
    expect(items(m).filter((i) => i.kind === "reconnect")).toHaveLength(0);
  });
});

describe("origin 嵌套路由", () => {
  it("子 session_meta 绑到最近已放行且未完成的 run_subagent 工具卡，卡内递归渲染", () => {
    const m = createStreamModel();
    pushMessage(m, toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "t1" }));
    pushMessage(m, approvalDecision("allow", "t1"));
    pushMessage(m, withOrigin(meta("child1"), "child1"));

    const card = items(m)[0] as ToolCallItem;
    expect(card.subagent).toBeDefined();
    expect(card.subagentSessionId).toBe("child1");

    // Child-session messages (after stripping the first hop) go into the card's nested model.
    pushMessage(m, withOrigin(userText("子任务"), "child1"));
    pushMessage(m, withOrigin(assistantText("子回复"), "child1"));
    const sub = card.subagent!;
    expect(sub.items).toHaveLength(2);
    expect(sub.items[0]).toMatchObject({ kind: "user_text", text: "子任务" });
    expect(sub.items[1]).toMatchObject({ kind: "assistant_text", text: "子回复" });
  });

  it("更深的 origin 链逐层剥离路由（孙会话）", () => {
    const m = createStreamModel();
    pushMessage(m, toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "t1" }));
    pushMessage(m, approvalDecision("allow", "t1"));
    pushMessage(m, withOrigin(meta("child1"), "child1"));
    // Grandchild-session message: origin = [child1, child2].
    pushMessage(m, withOrigin(withOrigin(assistantText("孙回复"), "child2"), "child1"));

    const sub = (items(m)[0] as ToolCallItem).subagent!;
    // Within the child model, child2 has no run_subagent card to bind to -> standalone SubagentCard.
    const nested = sub.items.find((i) => i.kind === "subagent") as SubagentItem;
    expect(nested).toBeDefined();
    expect(nested.sessionId).toBe("child2");
    expect(nested.model.items[0]).toMatchObject({ kind: "assistant_text", text: "孙回复" });
  });

  it("找不到可绑定卡时建独立 SubagentCard；被拒绝的卡不绑定", () => {
    const m = createStreamModel();
    pushMessage(m, toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "t1" }));
    pushMessage(m, approvalDecision("deny", "t1"));
    pushMessage(m, withOrigin(meta("childX"), "childX"));
    const standalone = items(m).find((i) => i.kind === "subagent") as SubagentItem;
    expect(standalone).toBeDefined();
    expect(standalone.sessionId).toBe("childX");
    expect((items(m)[0] as ToolCallItem).subagent).toBeUndefined();
  });

  it("子会话 token_usage 计入父级统计（tokens 含子会话，上下文不含）", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("任务"), "2026-07-05T00:00:00.000Z"));
    pushMessage(m, at(tokenUsage(counts(1000), counts(1000)), "2026-07-05T00:00:01.000Z"));
    pushMessage(
      m,
      at(withOrigin(tokenUsage(counts(400), counts(400)), "c1"), "2026-07-05T00:00:02.000Z"),
    );
    notifyTaskIdle(m, Date.now());
    const stats = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(stats.stats!.tokens).toBe(1400);
    expect(stats.stats!.tokensDelta).toBe(1400);
    expect(stats.stats!.context).toBe(1000);
  });
});

describe("消息时刻（页脚 hover 展示）", () => {
  it("用户与助手消息都带 atMs；助手流式先用 start 占位，完整消息到达后改用完成时刻", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("问"), "2026-07-05T00:00:00.000Z"));
    // Streaming: the start timestamp is used as a placeholder first.
    pushMessage(m, at(partialText("start"), "2026-07-05T00:00:01.000Z"));
    pushMessage(m, at(partialText("delta", "答"), "2026-07-05T00:00:02.000Z"));
    const reply = items(m)[1] as AssistantTextItem;
    expect(reply.atMs).toBe(Date.parse("2026-07-05T00:00:01.000Z"));
    // Full message arrives -> switch to the **completion** timestamp (matches Trace's
    // convention: Trace records completion time).
    pushMessage(m, at(partialText("stop"), "2026-07-05T00:00:03.000Z"));
    pushMessage(m, at(assistantText("答完了"), "2026-07-05T00:00:04.000Z"));

    const user = items(m)[0] as UserTextItem;
    expect(user.atMs).toBe(Date.parse("2026-07-05T00:00:00.000Z"));
    expect(reply.atMs).toBe(Date.parse("2026-07-05T00:00:04.000Z"));
  });

  it("历史重建（无流式片段）的助手消息同样带 atMs", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("问"), "2026-07-05T00:00:00.000Z"));
    pushMessage(m, at(assistantText("答"), "2026-07-05T00:00:05.000Z"));
    expect((items(m)[1] as AssistantTextItem).atMs).toBe(Date.parse("2026-07-05T00:00:05.000Z"));
  });
});

describe("Task 分段与统计触发", () => {
  it("user text/image 开启新 Task；下一个 Task 开始时补上一 Task 的统计行（历史口径）", () => {
    const m = createStreamModel();
    pushMessages(m, [
      at(userText("第一问"), "2026-07-05T00:00:00.000Z"),
      at(assistantText("第一答"), "2026-07-05T00:00:03.000Z"),
      at(tokenUsage(counts(1000), counts(1000)), "2026-07-05T00:00:05.000Z"),
      at(userText("第二问"), "2026-07-05T00:01:00.000Z"),
    ]);
    // Order: user1, text1, stats(task1), user2.
    expect(items(m).map((i) => i.kind)).toEqual([
      "user_text",
      "assistant_text",
      "task_stats",
      "user_text",
    ]);
    const stats = items(m)[2] as TaskStatsItem;
    expect(stats.stats!.context).toBe(1000);
    expect(stats.stats!.elapsedDeltaMs).toBe(5000); // time span from the first to the last message
  });

  it("流结尾（finalizeHistory）收口最后一个 Task；无 usage 的轮次不给统计数字，但仍给页脚", () => {
    const m = createStreamModel();
    pushMessages(m, [
      at(userText("有用量"), "2026-07-05T00:00:00.000Z"),
      at(tokenUsage(counts(500), counts(500)), "2026-07-05T00:00:01.000Z"),
      at(userText("无用量"), "2026-07-05T00:01:00.000Z"),
      at(assistantText("直接答"), "2026-07-05T00:01:01.000Z"),
    ]);
    finalizeHistory(m);
    const statsItems = items(m).filter((i) => i.kind === "task_stats") as TaskStatsItem[];
    expect(statsItems).toHaveLength(2);
    expect(statsItems[0]!.stats).not.toBeNull(); // has token_usage -> has stats
    // No token_usage (e.g. the reply was aborted mid-stream) -> no stats to show, but this item
    // must still be produced: it doubles as this reply's footer (timestamp + copy). Otherwise an
    // aborted reply would have neither a timestamp nor a copy button.
    expect(statsItems[1]!.stats).toBeNull();
    expect(statsItems[1]!.assistantText).toBe("直接答");
    expect(statsItems[1]!.atMs).toBe(Date.parse("2026-07-05T00:01:01.000Z"));
  });

  it("既无 usage 又无正文的轮次：不产出任何项", () => {
    const m = createStreamModel();
    pushMessages(m, [at(userText("空转"), "2026-07-05T00:00:00.000Z")]);
    finalizeHistory(m);
    expect(items(m).filter((i) => i.kind === "task_stats")).toHaveLength(0);
  });

  it("实时流以 task_state:idle 收口，用本地时钟计增量", () => {
    const m = createStreamModel();
    pushMessage(m, userText("实时问"), 10_000);
    pushMessage(m, tokenUsage(counts(800), counts(800)), 11_000);
    notifyTaskIdle(m, 15_100);
    const stats = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(stats.stats!.elapsedDeltaMs).toBe(5100);
    expect(stats.stats!.tokens).toBe(800);
  });

  it("image_url 完整消息同样开启新 Task", () => {
    const m = createStreamModel();
    pushMessage(m, tokenUsage(counts(100), counts(100))); // outside the Task boundary
    pushMessage(m, imageUrlMessage("data:image/png;base64,xx"));
    pushMessage(m, tokenUsage(counts(700), counts(600)));
    notifyTaskIdle(m);
    const stats = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    // Counts reset when the Task starts: the 100 outside the boundary isn't part of this Task's delta.
    expect(stats.stats!.tokensDelta).toBe(600);
  });

  it("Task 之间的手动压缩消耗不误记入下一 Task 增量", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("一"), "2026-07-05T00:00:00.000Z"));
    pushMessage(m, at(tokenUsage(counts(1000), counts(1000)), "2026-07-05T00:00:01.000Z"));
    notifyTaskIdle(m, Date.now());
    // Manual /compact (outside the Task boundary).
    pushMessage(
      m,
      compactionBegin({ reason: "manual", mode: "summarize", context: 1000, turns: 1 }),
    );
    pushMessage(m, tokenUsage(counts(1300), counts(300)));
    pushMessage(m, compactionEnd({ reason: "manual", mode: "summarize", status: "completed" }));
    // Next Task.
    pushMessage(m, at(userText("二"), "2026-07-05T00:02:00.000Z"));
    pushMessage(m, at(tokenUsage(counts(1800), counts(500)), "2026-07-05T00:02:01.000Z"));
    notifyTaskIdle(m, Date.now());
    const statsItems = items(m).filter((i) => i.kind === "task_stats") as TaskStatsItem[];
    const last = statsItems[statsItems.length - 1]!;
    expect(last.stats!.tokensDelta).toBe(500); // excludes the compaction's 300
    expect(last.stats!.context).toBe(500);
  });

  it("轮末取最后一个 request_end：其后到达的下一轮注入不撑大本轮用时", () => {
    // During history rebuild, the compaction summary `<context_summary>` is written alongside the
    // next round, with its timestamp landing in that next round — it arrives while the previous
    // round is still open. If round-end took the latest message seen, this injection would
    // artificially inflate the previous round's elapsed time (the old bug where elapsed grows
    // after a refresh); taking the last request_end instead naturally excludes it from the round.
    const m = createStreamModel();
    pushMessages(m, [
      at(userText("问"), "2026-07-05T00:00:00.000Z"),
      at(requestBegin(), "2026-07-05T00:00:01.000Z"),
      at(tokenUsage(out(100), out(100)), "2026-07-05T00:00:02.000Z"),
      at(requestEnd("completed"), "2026-07-05T00:00:03.000Z"), // this round's last request_end
      // Next round's summary injection, timestamped much later; it arrives while this round hasn't closed yet.
      at(userText("<context_summary>\n摘要\n</context_summary>"), "2026-07-05T00:00:50.000Z"),
      at(userText("下一问"), "2026-07-05T00:01:00.000Z"), // startTask: closes the previous round
    ]);
    finalizeHistory(m);
    const first = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(first.stats!.elapsedDeltaMs).toBe(3_000); // 00:00 -> 00:03, excludes the @00:50 injection
  });
});

describe("输出 TPS（request 事件配对计时）", () => {
  it("request_begin/request_end 配对累加本 Task LLM 时长，产出输出 TPS（含工具参数生成、不含工具执行）", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("q"), "2026-07-05T00:00:00.000Z"));
    pushMessage(m, at(requestBegin(), "2026-07-05T00:00:01.000Z"));
    // Main session outputs 900 tokens; request wall clock 01->04 = 3s (tool execution
    // happening between the two requests isn't counted).
    pushMessage(m, at(tokenUsage(out(900), out(900)), "2026-07-05T00:00:03.500Z"));
    pushMessage(m, at(requestEnd("completed"), "2026-07-05T00:00:04.000Z"));
    notifyTaskIdle(m, Date.now());
    const stats = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(stats.stats!.outputTps).toBe(300); // 900 / 3s
    expect(stats.stats!.tokensByBucket).toEqual({ cacheRead: 0, cacheWrite: 0, output: 900 });
  });

  it("同一 Task 多轮 request 时长累加；无 request 配对时 TPS 为 null", () => {
    const m = createStreamModel();
    // No request events -> no LLM timing -> TPS is null.
    pushMessage(m, at(userText("q1"), "2026-07-05T00:00:00.000Z"));
    pushMessage(m, at(tokenUsage(out(100), out(100)), "2026-07-05T00:00:01.000Z"));
    notifyTaskIdle(m, Date.now());
    const s1 = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(s1.stats!.outputTps).toBeNull();
    // Next Task: two request rounds of 2s each, 400 output tokens each -> 800 / 4s = 200 tok/s.
    pushMessage(m, at(userText("q2"), "2026-07-05T00:01:00.000Z"));
    pushMessage(m, at(requestBegin(), "2026-07-05T00:01:01.000Z"));
    pushMessage(m, at(tokenUsage(out(400), out(400)), "2026-07-05T00:01:02.500Z"));
    pushMessage(m, at(requestEnd("completed"), "2026-07-05T00:01:03.000Z")); // 2s
    pushMessage(m, at(requestBegin(), "2026-07-05T00:01:05.000Z"));
    pushMessage(m, at(tokenUsage(out(400), out(400)), "2026-07-05T00:01:06.500Z"));
    pushMessage(m, at(requestEnd("completed"), "2026-07-05T00:01:07.000Z")); // 2s
    notifyTaskIdle(m, Date.now());
    const stats = items(m).filter((i) => i.kind === "task_stats") as TaskStatsItem[];
    expect(stats[stats.length - 1]!.stats!.outputTps).toBe(200);
  });

  it("人工审批等待不计入 TPS 分母（与 Trace 页 activeMs 同口径）", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("q"), "2026-07-05T00:00:00.000Z"));
    pushMessage(m, at(requestBegin(), "2026-07-05T00:00:01.000Z"));
    // core does `await approve(tc)` in the streaming loop: until approval returns, it won't
    // consume the next chunk and request_end won't fire either, so this 30s of human approval
    // wait sits entirely between the pair of request events.
    pushMessage(
      m,
      at(
        toolCall({ name: "exec_command", arguments: "{}", toolCallId: "t1" }),
        "2026-07-05T00:00:02.000Z",
      ),
    );
    pushMessage(m, at(approvalDecision("allow", "t1"), "2026-07-05T00:00:32.000Z"));
    pushMessage(m, at(tokenUsage(out(1000), out(1000)), "2026-07-05T00:00:32.500Z"));
    pushMessage(m, at(requestEnd("completed"), "2026-07-05T00:00:33.000Z"));
    notifyTaskIdle(m, Date.now());
    const stats = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    // Wall clock 32s, minus 30s approval -> 2s of generation: 1000 / 2s = 500 tok/s
    // (without subtracting it, it would be only 31 tok/s).
    expect(stats.stats!.outputTps).toBe(500);
  });

  it("压缩请求的计时与输出都不计入 TPS（只算普通请求，与 Trace 页压缩自成一轮一致）", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("q"), "2026-07-05T00:00:00.000Z"));
    pushMessage(m, at(requestBegin(), "2026-07-05T00:00:01.000Z"));
    pushMessage(m, at(tokenUsage(out(600), out(600)), "2026-07-05T00:00:02.000Z"));
    pushMessage(m, at(requestEnd("completed"), "2026-07-05T00:00:03.000Z")); // 2s
    // Compaction span: both its request timing and its output should be skipped.
    pushMessage(
      m,
      at(
        compactionBegin({ reason: "manual", mode: "summarize", context: 600, turns: 1 }),
        "2026-07-05T00:00:04.000Z",
      ),
    );
    pushMessage(m, at(requestBegin(), "2026-07-05T00:00:04.500Z"));
    pushMessage(m, at(tokenUsage(out(999), out(1599)), "2026-07-05T00:00:19.000Z")); // compaction summary output
    pushMessage(m, at(requestEnd("completed"), "2026-07-05T00:00:20.000Z")); // compaction request, 15.5s, excluded
    pushMessage(
      m,
      at(
        compactionEnd({ reason: "manual", mode: "summarize", status: "completed" }),
        "2026-07-05T00:00:21.000Z",
      ),
    );
    notifyTaskIdle(m, Date.now());
    const stats = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(stats.stats!.outputTps).toBe(300); // 600 / 2s (the compaction request's 999 output and 15.5s are excluded)
  });
});

describe("压缩按落点归属：轮内计入本轮、轮后不计", () => {
  it("本轮用时止于最后一个 request_end；收尾压缩排在轮外，天然不计；统计行排在压缩横幅之前", () => {
    // Auto-compaction triggered at the **end** of a round: compaction is itself a full LLM
    // request (here 20s). It sits entirely **after** the round's last request_end. Using "the
    // last request_end" as the round boundary naturally excludes it — no need to walk each
    // message or specially subtract time for tail compaction (consistent with its Token / TPS
    // already being excluded).
    const m = createStreamModel();
    pushMessages(m, [
      at(userText("问"), "2026-07-05T00:00:00.000Z"),
      at(requestBegin(), "2026-07-05T00:00:01.000Z"),
      at(assistantText("答"), "2026-07-05T00:00:02.500Z"),
      at(tokenUsage(out(600), out(600)), "2026-07-05T00:00:02.900Z"),
      at(requestEnd("completed"), "2026-07-05T00:00:03.000Z"), // this round's last request_end
      // Tail compaction: 00:04 -> 00:24, a full 20s, entirely after the round end
      at(
        compactionBegin({ reason: "context", mode: "summarize", context: 600, turns: 1 }),
        "2026-07-05T00:00:04.000Z",
      ),
      at(tokenUsage(out(300), out(300)), "2026-07-05T00:00:20.000Z"), // the compaction request's own usage
      at(
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
        "2026-07-05T00:00:24.000Z",
      ),
    ]);
    finalizeHistory(m);

    // The stats row comes **before** the compaction banner: it's about this round of
    // conversation, not the compaction result.
    expect(items(m).map((i) => i.kind)).toEqual([
      "user_text",
      "assistant_text",
      "task_stats",
      "compaction",
    ]);

    const stats = items(m)[2] as TaskStatsItem;
    // This round: 00:00 -> last request_end 00:03 = 3s. Compaction sits entirely after the round end, none of it counts.
    expect(stats.stats!.elapsedDeltaMs).toBe(3_000);
  });

  it("轮次**进行中**的压缩：夹在本轮跨度之内，用时与 Token 都算进本轮", () => {
    // After compaction, the engine keeps running with the carry-over, and this round still has a
    // normal Request after compaction — so compaction sits between two of this round's
    // request_ends. It genuinely is time and cost spent to finish this round's work, so both
    // elapsed time (naturally spanned) and Token count it toward this round. The test is
    // "is there still a normal Request after compaction within this round?": yes -> counted
    // (within the round); no -> after the round (excluded, see the previous test case).
    // Compaction's output still doesn't count toward TPS (it isn't generation for a user request).
    const m = createStreamModel();
    pushMessages(m, [
      at(userText("问"), "2026-07-05T00:00:00.000Z"),
      at(requestBegin(), "2026-07-05T00:00:01.000Z"),
      at(tokenUsage(out(100), out(100)), "2026-07-05T00:00:02.000Z"),
      at(requestEnd("completed"), "2026-07-05T00:00:03.000Z"), // own1: 2s, 100 output tokens
      // Mid-round compaction: 00:03 -> 00:23, a full 20s, 50 output tokens
      at(
        compactionBegin({ reason: "context", mode: "summarize", context: 100, turns: 1 }),
        "2026-07-05T00:00:03.000Z",
      ),
      at(requestBegin(), "2026-07-05T00:00:04.000Z"),
      at(tokenUsage(out(50), out(50)), "2026-07-05T00:00:20.000Z"),
      at(requestEnd("completed"), "2026-07-05T00:00:22.000Z"), // compaction request, excluded from TPS
      at(
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
        "2026-07-05T00:00:23.000Z",
      ),
      // This round keeps running after compaction
      at(requestBegin(), "2026-07-05T00:00:24.000Z"),
      at(assistantText("答"), "2026-07-05T00:00:25.000Z"),
      at(tokenUsage(out(200), out(200)), "2026-07-05T00:00:25.000Z"),
      at(requestEnd("completed"), "2026-07-05T00:00:26.000Z"), // own2: 2s, 200 output tokens
    ]);
    finalizeHistory(m);
    const stats = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    // Elapsed = first message 00:00 -> last request_end 00:26 = 26s (includes the 20s of
    // compaction in between, which took up this round's wall clock).
    expect(stats.stats!.elapsedDeltaMs).toBe(26_000);
    // Token / cost includes compaction's 50: own1 100 + own2 200 + compaction 50 = 350.
    expect(stats.stats!.tokensByBucket.output).toBe(350);
    // But TPS only counts the two normal requests: 300 output / 4s LLM time (own1 2s + own2 2s,
    // compaction's 18s excluded) = 75 tok/s.
    expect(stats.stats!.outputTps).toBe(75);
  });

  it("本轮被打断后隔很久才发下一条：上一轮的用时不含这段空档", () => {
    const m = createStreamModel();
    pushMessages(m, [
      at(userText("问"), "2026-07-05T00:00:00.000Z"),
      at(requestBegin(), "2026-07-05T00:00:01.000Z"),
      at(tokenUsage(out(100), out(100)), "2026-07-05T00:00:02.000Z"),
      at(requestEnd("aborted"), "2026-07-05T00:00:03.000Z"),
      at(abortEvent("user"), "2026-07-05T00:00:03.000Z"),
      // The user doesn't send the next message until 60 seconds later
      at(userText("再问"), "2026-07-05T00:01:03.000Z"),
      at(requestBegin(), "2026-07-05T00:01:04.000Z"),
      at(tokenUsage(out(50), out(50)), "2026-07-05T00:01:05.000Z"),
      at(requestEnd("completed"), "2026-07-05T00:01:06.000Z"),
    ]);
    finalizeHistory(m);
    const all = items(m).filter((i) => i.kind === "task_stats") as TaskStatsItem[];
    expect(all[0]!.stats!.elapsedDeltaMs).toBe(3_000); // excludes the 60s the user was away
    expect(all[1]!.stats!.elapsedDeltaMs).toBe(3_000);
  });

  it("手动 /compact 夹在两轮之间：上一轮的账目不吃压缩（历史重建须与实时流一致）", () => {
    const m = createStreamModel();
    pushMessages(m, [
      at(userText("问"), "2026-07-05T00:00:00.000Z"),
      at(requestBegin(), "2026-07-05T00:00:01.000Z"),
      at(tokenUsage(out(100), out(100)), "2026-07-05T00:00:02.000Z"),
      at(requestEnd("completed"), "2026-07-05T00:00:03.000Z"),
      // This round ends here. The user reads the reply, thinks for 10 seconds, then types
      // /compact — in the live stream this round already closed at idle, so compaction's
      // usage and duration don't count toward it.
      at(
        compactionBegin({ reason: "manual", mode: "summarize", context: 100, turns: 1 }),
        "2026-07-05T00:00:13.000Z",
      ),
      at(requestBegin(), "2026-07-05T00:00:13.000Z"),
      at(tokenUsage(out(900), out(900)), "2026-07-05T00:00:32.000Z"),
      at(requestEnd("completed"), "2026-07-05T00:00:33.000Z"),
      at(
        compactionEnd({ reason: "manual", mode: "summarize", status: "completed" }),
        "2026-07-05T00:00:33.000Z",
      ),
      at(userText("<context_summary>\n摘要\n</context_summary>"), "2026-07-05T00:00:33.000Z"),
    ]);
    finalizeHistory(m);
    const stats = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    // Elapsed only runs to this round's last message (00:03) — it excludes both the 10-second
    // thinking gap and the 20-second compaction.
    expect(stats.stats!.elapsedDeltaMs).toBe(3_000);
    // Compaction's 900 output tokens also aren't charged to this round (otherwise cost would
    // double out of nowhere after a refresh).
    expect(stats.stats!.tokensByBucket.output).toBe(100);
  });
});

describe("压缩内部消息（#17：历史重建与实时流对齐）", () => {
  it("压缩区间内的压缩 Prompt 与摘要输出不渲染、不参与 Task 分段；context 口径不被污染", () => {
    const m = createStreamModel();
    pushMessages(m, [
      at(userText("任务"), "2026-07-05T00:00:00.000Z"),
      at(tokenUsage(counts(10000), counts(10000)), "2026-07-05T00:00:05.000Z"),
      at(
        compactionBegin({ reason: "context", mode: "summarize", context: 10000, turns: 5 }),
        "2026-07-05T00:00:06.000Z",
      ),
      // Compaction prompt (user text) and the compaction request's summary output (assistant text): internal messages.
      at(userText("请总结上文（压缩 Prompt）"), "2026-07-05T00:00:06.100Z"),
      at(assistantText("<summary>摘要内容</summary>"), "2026-07-05T00:00:09.000Z"),
      at(tokenUsage(counts(11000), counts(1000)), "2026-07-05T00:00:09.500Z"),
      at(
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
        "2026-07-05T00:00:10.000Z",
      ),
      // Summary injected at the start of the new context file: internal input.
      at(userText("<context_summary>\n摘要内容\n</context_summary>"), "2026-07-05T00:00:10.500Z"),
      at(userText("下一问"), "2026-07-05T00:01:00.000Z"),
      at(tokenUsage(counts(3000), counts(3000)), "2026-07-05T00:01:05.000Z"),
    ]);
    finalizeHistory(m);
    // Order: user(task), **stats(task1)**, compaction banner, user(next question), stats(task2)
    // — internal messages don't appear. The stats row comes **before** the compaction banner:
    // it's about this round of conversation, while compaction is housekeeping outside this
    // round, listed after the tally.
    expect(items(m).map((i) => i.kind)).toEqual([
      "user_text",
      "task_stats",
      "compaction",
      "user_text",
      "task_stats",
    ]);
    // The compaction-complete row only states "compaction happened, succeeded or not" — it doesn't show Token counts.
    const banner = items(m)[2] as CompactionItem;
    expect(banner.running).toBe(false);
    expect(banner).not.toHaveProperty("tokens");
    // task1: context takes the total from the normal pre-compaction request (the compaction
    // request doesn't update the context figure).
    const stats1 = items(m)[1] as TaskStatsItem;
    expect(stats1.stats!.context).toBe(10000);
    expect(stats1.stats!.tokensDelta).toBe(10000); // excludes compaction request usage: compaction is its own round, not attributed to a user round
    // task2: context is the actual usage after compaction, so the delta can be negative.
    const stats2 = items(m)[4] as TaskStatsItem;
    expect(stats2.stats!.context).toBe(3000);
    expect(stats2.stats!.contextDelta).toBe(-7000);
    expect(stats2.stats!.tokensDelta).toBe(3000); // excludes compaction usage
  });

  it("Task 进行中的压缩：区间后消息仍归属同一 Task，context_summary 不开新 Task", () => {
    const m = createStreamModel();
    pushMessages(m, [
      at(userText("修复 bug"), "2026-07-05T00:00:00.000Z"),
      at(tokenUsage(counts(9000), counts(9000)), "2026-07-05T00:00:05.000Z"),
      at(
        compactionBegin({ reason: "context", mode: "summarize", context: 9000, turns: 3 }),
        "2026-07-05T00:00:06.000Z",
      ),
      at(userText("压缩 Prompt"), "2026-07-05T00:00:06.100Z"),
      at(assistantText("<summary>进展摘要</summary>"), "2026-07-05T00:00:08.000Z"),
      at(
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
        "2026-07-05T00:00:09.000Z",
      ),
      // Mid-round compaction: the summary is written as the new context's first input, after end.
      at(userText("<context_summary>\n进展摘要\n</context_summary>"), "2026-07-05T00:00:09.500Z"),
      at(assistantText("继续修复并完成"), "2026-07-05T00:00:12.000Z"),
    ]);
    finalizeHistory(m);
    const kinds = items(m).map((i) => i.kind);
    // Only one Task: user, banner, assistant (output after compaction continues), stats.
    expect(kinds).toEqual(["user_text", "compaction", "assistant_text", "task_stats"]);
    expect((items(m)[2] as AssistantTextItem).text).toBe("继续修复并完成");
    expect(items(m).filter((i) => i.kind === "user_text")).toHaveLength(1);
  });
});

describe("live 收口用时（#5/#20：中途加入取消息时间戳下界）", () => {
  it("刷新后立刻结束的 Task：elapsed 取消息时间戳跨度而非本地时钟增量", () => {
    const m = createStreamModel();
    const loadNow = 1_000_000;
    // History replay: the Task actually ran for 60s.
    pushMessages(
      m,
      [
        at(userText("跑了很久的任务"), "2026-07-05T00:00:00.000Z"),
        at(assistantText("输出"), "2026-07-05T00:01:00.000Z"),
        at(tokenUsage(counts(500), counts(500)), "2026-07-05T00:01:00.000Z"),
      ],
      loadNow,
    );
    // task_state:idle arrives 2s after joining.
    notifyTaskIdle(m, loadNow + 2000);
    const stats = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(stats.stats!.elapsedDeltaMs).toBe(60_000);
    expect(stats.stats!.elapsedMs).toBe(60_000); // sessionElapsedMs is corrected in sync
  });

  it("本地时钟增量更大时（正常实时流）仍取本地时钟", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("实时问"), "2026-07-05T00:00:00.000Z"), 10_000);
    pushMessage(m, at(tokenUsage(counts(800), counts(800)), "2026-07-05T00:00:01.000Z"), 11_000);
    notifyTaskIdle(m, 15_100);
    const stats = items(m).find((i) => i.kind === "task_stats") as TaskStatsItem;
    expect(stats.stats!.elapsedDeltaMs).toBe(5100);
  });
});

describe("审批键与工具卡定位（#7/#19）", () => {
  it("approvalKey 按 origin 链区分同名 toolCallId", () => {
    expect(approvalKey(undefined, "t1")).toBe(" t1");
    expect(approvalKey([], "t1")).toBe(" t1");
    expect(approvalKey(["c1"], "t1")).toBe("c1 t1");
    expect(approvalKey(["c1", "c2"], "t1")).toBe("c1/c2 t1");
    expect(approvalKey(["c1"], "t1")).not.toBe(approvalKey(undefined, "t1"));
  });

  it("findToolCard 按 origin 链定位任意深度的工具卡", () => {
    const m = createStreamModel();
    pushMessage(m, toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "t1" }));
    pushMessage(m, approvalDecision("allow", "t1"));
    // A child-session tool card with the same toolCallId.
    pushMessage(m, withOrigin(meta("c1"), "c1"));
    pushMessage(
      m,
      withOrigin(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "t1" }), "c1"),
    );

    const main = findToolCard(m, undefined, "t1");
    const nested = findToolCard(m, ["c1"], "t1");
    expect(main?.name).toBe("run_subagent");
    expect(nested?.name).toBe("exec_command");
    expect(main).not.toBe(nested);
    expect(findToolCard(m, ["cX"], "t1")).toBeNull();
    expect(findToolCard(m, ["c1"], "tX")).toBeNull();
  });
});

describe("localDecisions 共享集合（#22：resync 重建存续）", () => {
  it("注入共享集合的新模型仍把此前登记的审批标「人工」", () => {
    const shared = new Set<string>();
    const m1 = createStreamModel(shared);
    registerLocalDecision(m1, "t1");
    // resync rebuild: inject the same set into a fresh model, replaying history.
    const m2 = createStreamModel(shared);
    pushMessage(m2, toolCall({ name: "x", arguments: "{}", toolCallId: "t1" }));
    pushMessage(m2, approvalDecision("allow", "t1"));
    expect((items(m2)[0] as ToolCallItem).decisionSource).toBe("manual");
  });
});

describe("重叠去重（契约 §7.2）", () => {
  it("buildDedupIndex 只索引最后 limit 条；isDuplicate 按外壳 JSON 完全相同判重", () => {
    const m1 = at(userText("一"), "2026-07-05T00:00:00.000Z");
    const m2 = at(assistantText("二"), "2026-07-05T00:00:01.000Z");
    const m3 = at(assistantText("三"), "2026-07-05T00:00:02.000Z");
    const index = buildDedupIndex([m1, m2, m3], 2);
    expect(isDuplicate(index, m1)).toBe(false); // already slid out of the window
    expect(isDuplicate(index, m2)).toBe(true);
    expect(isDuplicate(index, { ...m3 })).toBe(true); // matches on identical structure
  });

  it("完整消息命中去重时丢弃对应在途片段（discardFragmentFor）", () => {
    const m = createStreamModel();
    // History already contains the full message.
    const complete = at(assistantText("你好"), "2026-07-05T00:00:00.000Z");
    pushMessage(m, complete);
    expect(items(m)).toHaveLength(1);
    // The streaming copy from the replay buffer reaches the reducer first.
    pushMessage(m, partialText("start"));
    pushMessage(m, partialText("delta", "你好"));
    expect(items(m)).toHaveLength(2);
    // The subsequent full message matches on dedup -> the in-flight fragment is discarded.
    discardFragmentFor(m, complete);
    expect(items(m)).toHaveLength(1);
    expect((items(m)[0] as AssistantTextItem).text).toBe("你好");
  });

  it("嵌套（带 origin）的在途片段同样可被丢弃", () => {
    const m = createStreamModel();
    pushMessage(m, withOrigin(meta("c1"), "c1"));
    pushMessage(m, withOrigin(partialText("start"), "c1"));
    pushMessage(m, withOrigin(partialText("delta", "子文本"), "c1"));
    const sub = (items(m).find((i) => i.kind === "subagent") as SubagentItem).model;
    expect(sub.items).toHaveLength(1);
    discardFragmentFor(m, withOrigin(assistantText("子文本"), "c1"));
    expect(sub.items).toHaveLength(0);
  });
});

describe("思考/工具耗时（折叠行展示数据）", () => {
  const T0 = "2026-07-07T00:00:00.000Z";
  const T1 = "2026-07-07T00:00:03.200Z";
  const T2 = "2026-07-07T00:00:08.000Z";
  const TAPPROVE = "2026-07-07T00:00:05.000Z";

  it("流式工具（含审批）：耗时 = 生成段 + 执行段，扣除审批等待", () => {
    const m = createStreamModel();
    pushMessage(
      m,
      at(partialToolCall({ eventType: "start", name: "exec_command", toolCallId: "ta" }), T0),
    );
    pushMessage(m, at(partialToolCall({ eventType: "stop", name: "", toolCallId: "ta" }), T1));
    // Approval waits between T1 and TAPPROVE (1.8s), which isn't counted toward duration.
    pushMessage(m, at(approvalDecision("allow", "ta"), TAPPROVE));
    pushMessage(m, at(partialToolCallOutput({ eventType: "start", toolCallId: "ta" }), TAPPROVE));
    pushMessage(m, at(partialToolCallOutput({ eventType: "stop", toolCallId: "ta" }), T2));
    const card = items(m)[0] as ToolCallItem;
    // Generation segment T0->T1 (3200ms) + execution segment TAPPROVE->T2 (3000ms) = 6200ms; the 1800ms approval wait is subtracted.
    expect(card.durationMs).toBe(6200);
  });

  it("流式思考：partial start 记开始，完整消息按时间戳结算耗时", () => {
    const m = createStreamModel();
    pushMessage(m, at(partialThinking("start"), T0));
    pushMessage(m, at(partialThinking("delta", "推理"), T0));
    pushMessage(m, at(partialThinking("stop"), T1));
    pushMessage(m, at(thinkingMessage("推理", "completed"), T1));
    const th = items(m)[0] as ThinkingItem;
    expect(th.startedAtMs).toBe(Date.parse(T0));
    expect(th.durationMs).toBe(3200);
  });

  it("历史思考（无片段）：以上一条消息时间近似开始", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("问题"), T0));
    pushMessage(m, at(thinkingMessage("推理", "completed"), T1));
    const th = items(m).find((i) => i.kind === "thinking") as ThinkingItem;
    expect(th.startedAtMs).toBe(Date.parse(T0));
    expect(th.durationMs).toBe(3200);
  });

  it("工具耗时：tool_call 收口 → tool_call_output 完整（与 Trace 分析同口径）", () => {
    const m = createStreamModel();
    pushMessage(m, at(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "t1" }), T1));
    const card = items(m)[0] as ToolCallItem;
    expect(card.callStartedAtMs).toBe(Date.parse(T1));
    expect(card.durationMs).toBeUndefined();
    pushMessage(m, at(toolCallOutput({ output: "ok", toolCallId: "t1" }), T2));
    expect(card.durationMs).toBe(4800);
  });

  it("工具耗时扣除审批等待：从审批通过时刻起算到输出（非调用时刻）", () => {
    const m = createStreamModel();
    const Ta = "2026-07-07T00:00:05.000Z"; // approval granted: after call(T1), before output(T2)
    pushMessage(m, at(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "t1" }), T1));
    pushMessage(m, at(approvalDecision("allow", "t1"), Ta));
    pushMessage(m, at(toolCallOutput({ output: "ok", toolCallId: "t1" }), T2));
    const card = items(m)[0] as ToolCallItem;
    expect(card.approvalAtMs).toBe(Date.parse(Ta));
    expect(card.durationMs).toBe(3000); // T2 - Ta (subtracting the T1->Ta approval wait), not 4800
  });

  it("中断收口：执行中的工具卡不再滚动计时（outputComplete 置位、耗时保持缺省）", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("问"), T0));
    pushMessage(m, at(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "ta" }), T1));
    pushMessage(m, at(abortEvent("user"), T2));
    const card = items(m).find((i) => i.kind === "tool_call") as ToolCallItem;
    expect(card.outputComplete).toBe(true);
    expect(card.outputStreaming).toBe(false);
    expect(card.durationMs).toBeUndefined();
    // Never produced a result: it must be recorded as aborted, otherwise it renders as a "completed" checkmark.
    expect(card.outputStopReason).toBe("aborted");
  });

  it("Task 收口（task_state:idle）同样关闭执行中的工具卡", () => {
    const m = createStreamModel();
    pushMessage(m, at(userText("问"), T0));
    pushMessage(m, at(toolCall({ name: "x", arguments: "{}", toolCallId: "tb" }), T1));
    notifyTaskIdle(m, Date.parse(T2));
    const card = items(m).find((i) => i.kind === "tool_call") as ToolCallItem;
    expect(card.outputComplete).toBe(true);
    expect(card.outputStopReason).toBe("aborted");
  });

  it("历史工具（无片段）：以上一条消息时间近似参数生成起点，耗时含生成段", () => {
    // Replaying Trace after a page refresh: there's no partial_tool_call start. Without
    // approximating the generation start, tool duration would silently lose the argument
    // generation segment (the model emits arguments token by token, often the bulk of the time).
    const m = createStreamModel();
    pushMessage(m, at(userText("问题"), T0));
    pushMessage(m, at(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "th" }), T1));
    const card = items(m).find((i) => i.kind === "tool_call") as ToolCallItem;
    expect(card.argStartedAtMs).toBe(Date.parse(T0));
    pushMessage(m, at(toolCallOutput({ output: "ok", toolCallId: "th" }), T2));
    // Generation segment T0->T1 (3200ms) + execution segment T1->T2 (4800ms).
    expect(card.durationMs).toBe(8000);
  });

  it("流式工具：耗时 = 参数生成段 + 执行段（无审批），完整消息不回缩", () => {
    const m = createStreamModel();
    pushMessage(
      m,
      at(partialToolCall({ eventType: "start", name: "read_file", toolCallId: "t2" }), T0),
    );
    pushMessage(m, at(partialToolCall({ eventType: "stop", name: "", toolCallId: "t2" }), T1));
    const card = items(m)[0] as ToolCallItem;
    expect(card.argStartedAtMs).toBe(Date.parse(T0));
    expect(card.callStartedAtMs).toBe(Date.parse(T1));
    pushMessage(m, at(partialToolCallOutput({ eventType: "start", toolCallId: "t2" }), T1));
    pushMessage(m, at(partialToolCallOutput({ eventType: "stop", toolCallId: "t2" }), T2));
    // Generation segment T0->T1 (3200ms) + execution segment T1->T2 (4800ms) = 8000ms (no approval wait).
    expect(card.durationMs).toBe(8000);
    // The later full tool_call_output only fills in the execution segment, without overwriting the generation segment already included.
    pushMessage(m, at(toolCallOutput({ output: "x", toolCallId: "t2" }), T2));
    expect(card.durationMs).toBe(8000);
  });
});

describe("重复 tool_call_id 的多次调用（name-as-id provider 存量 Trace 兜底）", () => {
  it("已完成卡再收到同 id 完整 tool_call：另建新卡，不覆盖旧卡", () => {
    const m = createStreamModel();
    // Round 1: get_time(Tokyo) call + output.
    pushMessage(
      m,
      toolCall({ name: "get_time", arguments: '{"city":"Tokyo"}', toolCallId: "get_time" }),
    );
    pushMessage(m, toolCallOutput({ output: "10:00 Tokyo", toolCallId: "get_time" }));
    // Round 2: same id called again (a legacy Trace where Gemini uses the function name as id).
    pushMessage(
      m,
      toolCall({ name: "get_time", arguments: '{"city":"Paris"}', toolCallId: "get_time" }),
    );
    pushMessage(m, toolCallOutput({ output: "03:00 Paris", toolCallId: "get_time" }));

    const cards = items(m).filter((it) => it.kind === "tool_call") as ToolCallItem[];
    expect(cards).toHaveLength(2);
    expect(cards[0]!.argumentsText).toBe('{"city":"Tokyo"}');
    expect(cards[0]!.output).toBe("10:00 Tokyo");
    expect(cards[0]!.outputComplete).toBe(true);
    expect(cards[1]!.argumentsText).toBe('{"city":"Paris"}');
    expect(cards[1]!.output).toBe("03:00 Paris");
    expect(cards[1]!.outputComplete).toBe(true);
  });

  it("重复 id 的第二次调用：流式输出与审批决定归属最新卡", () => {
    const m = createStreamModel();
    pushMessage(m, toolCall({ name: "exec", arguments: '{"cmd":"a"}', toolCallId: "exec" }));
    pushMessage(m, toolCallOutput({ output: "out-a", toolCallId: "exec" }));
    pushMessage(m, toolCall({ name: "exec", arguments: '{"cmd":"b"}', toolCallId: "exec" }));
    pushMessage(m, approvalDecision("allow", "exec"));
    pushMessage(m, partialToolCallOutput({ eventType: "start", toolCallId: "exec" }));
    pushMessage(
      m,
      partialToolCallOutput({ eventType: "delta", output: "out-b", toolCallId: "exec" }),
    );
    pushMessage(m, partialToolCallOutput({ eventType: "stop", toolCallId: "exec" }));

    const cards = items(m).filter((it) => it.kind === "tool_call") as ToolCallItem[];
    expect(cards).toHaveLength(2);
    expect(cards[0]!.output).toBe("out-a"); // old card isn't touched by the second call
    expect(cards[0]!.decision).toBeUndefined();
    expect(cards[1]!.decision).toBe("allow");
    expect(cards[1]!.output).toBe("out-b");
  });

  it("被顶替时旧卡仍在执行中（无输出）：按中断收口，不再等输出", () => {
    const m = createStreamModel();
    pushMessage(m, toolCall({ name: "exec", arguments: '{"cmd":"slow"}', toolCallId: "exec" }));
    // Old card's output isn't closed (callComplete with outputComplete=false) when a new same-id call arrives.
    pushMessage(m, toolCall({ name: "exec", arguments: '{"cmd":"next"}', toolCallId: "exec" }));

    const cards = items(m).filter((it) => it.kind === "tool_call") as ToolCallItem[];
    expect(cards).toHaveLength(2);
    expect(cards[0]!.outputComplete).toBe(true);
    expect(cards[0]!.outputStopReason).toBe("aborted");
    expect(cards[1]!.outputComplete).toBe(false); // new card waits for output as normal
  });
});
