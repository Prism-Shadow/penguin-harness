/**
 * The messages of the render command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface RenderText {
  /**
   * Stats shown at the end of each Task: Session cumulative values plus this task's delta —
   * context window length, Token usage, elapsed time. Delta strings carry their own sign
   * (contextDelta can be negative after context is compacted), e.g.
   * `[stats] context 4k (+1k) · tokens 6k (+1.2k) · 5.1s (+2.3s)`.
   */
  taskStats(s: {
    context: string;
    contextDelta: string;
    tokens: string;
    tokensDelta: string;
    elapsed: string;
    elapsedDelta: string;
  }): string;

  /** Abort line (user interruptions only): the cause localizes from `errorCode`; `errorMessage` (raw, untranslatable) rides verbatim; a legacy Trace without a code renders its English `reason` prose as-is. */
  abortLabel(abort?: { errorCode?: string; errorMessage?: string; reason?: string }): string;

  /** Run-ending LLM failure (request_end status fatal — no abort event follows); the provider's error text rides verbatim. */
  llmFatalLabel(errorMessage?: string): string;

  /** The retry ladder gave up (request_end `retryable` with no planned retry); `attempt` is the final attempt's ordinal, `errorMessage` the last failure's detail. */
  reconnectGaveUpLabel(attempt: number, errorMessage?: string): string;

  /**
   * request_end ended with a status the engine reconnects on: the engine retries carrying
   * already-produced content; attempt is the retry count. The cause wording localizes from
   * `errorCode` (legacy Traces: the retired status spellings say the same thing).
   */
  reconnectLabel(
    status: "retryable" | "failed" | "timeout" | "malformed",
    attempt: number,
    errorCode?: string,
  ): string;

  /** compaction start event: indicates compaction in progress (mode is summarize/discard, reason is context/turns/manual). */
  compactionStart(mode: string, reason: string): string;

  /**
   * compaction stop event: the compaction result (status is completed/failed/aborted;
   * completed varies its text by mode). tokens is Token usage (same convention as the stats
   * line: total = Session cumulative, delta = consumed by this compaction, carrying its own
   * sign); when present it is appended at the end of the line, e.g. ` · tokens 14k (+6k)`.
   * `degraded` marks a completion without a full summary (errorMessage says why) as a suffix;
   * `room` adds what to correct when too little room was left for the compaction.
   */
  compactionStop(
    mode: string,
    status: string,
    tokens?: { total: string; delta: string },
    errorMessage?: string,
    degraded?: { room: boolean },
  ): string;

  /** mcp_connect_begin event: the configured MCP servers are being connected (the first run, or a new context after compaction). */
  mcpConnectStart(servers: string[]): string;

  /** mcp_connect_end event, one line: total wall time; `failures` carries "server (reason)" per failed connect (empty = all ok); `aborted` = the user interrupted mid-connect. */
  mcpConnectStop(
    durationMs: number,
    failures: { server: string; error: string }[],
    aborted: boolean,
  ): string;

  /** Dim line for a hook's answer (any hook but goal, whose own lines cover it): name, decision, reason. */
  hookEvent(name: string, decision: string | undefined, reason: string | undefined): string;

  /** Dim elision-marker line inside a collapsed tool output; `hidden` = lines not shown (>= 2). */
  toolOutputElided(hidden: number): string;

  /** Render label for an approval decision (frontend renders the approval_decision event; one label each for allow/deny). */
  approvalDecision(decision: "allow" | "deny" | "forbidden"): string;

  /** Prefix for a rendered [user_steering] line (a mid-run user message delivered between turns). */
  steerLinePrefix(): string;
}

/** The English half of this contribution's messages. */
export const renderEn: RenderText = {
  taskStats: (s) =>
    `[stats] context ${s.context} (${s.contextDelta}) · tokens ${s.tokens} (${s.tokensDelta}) · ${s.elapsed} (${s.elapsedDelta})`,

  abortLabel: (abort) => {
    if (abort?.errorCode === "max_turns") return "[stopped]: reached the maximum turns per task";
    const cause =
      abort?.errorCode === "user_abort"
        ? "aborted by user"
        : abort?.errorCode === "backoff_interrupted"
          ? "aborted during reconnect backoff"
          : abort?.errorCode === "compaction_interrupted"
            ? "aborted during compaction"
            : (abort?.errorCode ?? abort?.reason ?? "");
    const text = cause ? `${cause}${abort?.errorMessage ? `: ${abort.errorMessage}` : ""}` : "";
    return `[abort]${text ? `: ${text}` : ""}`;
  },

  llmFatalLabel: (errorMessage) =>
    `[error] llm request error${errorMessage ? `: ${errorMessage}` : ""}`,

  reconnectGaveUpLabel: (attempt, errorMessage) =>
    `[retry] giving up after attempt ${attempt}${errorMessage ? `: ${errorMessage}` : ""}`,

  reconnectLabel: (status, attempt, errorCode) =>
    // The live protocol carries the classified cause on error_code; the legacy status
    // spellings say the same thing for pre-convergence Traces.
    `[retry] ${((kind) =>
      kind === "timeout"
        ? "connection timed out"
        : kind === "malformed"
          ? "response incomplete or unparseable"
          : kind === "network"
            ? "network or service temporarily unavailable"
            : kind === "image_rejected"
              ? "the model provider rejected an image in this turn's input (replaced with a note)"
              : kind === "failed"
                ? "the model provider returned an error"
                : kind === "output_truncated"
                  ? "the model's output was cut off at the output limit"
                  : kind === "failed"
                    ? "the model provider returned an error"
                    : kind === "rejected"
                      ? "the model provider rejected the request"
                      : kind === "denied"
                        ? "the provider will not serve this account or model (balance, permission, or no such model)"
                        : "the request failed")(errorCode ?? status)}; sending retry #${attempt}…`,

  compactionStart: (mode, reason) =>
    mode === "discard"
      ? `[compaction] discarding context (${reason})…`
      : `[compaction] summarizing context (${reason})…`,

  compactionStop: (mode, status, tokens, errorMessage, degraded) =>
    (status === "completed"
      ? mode === "discard"
        ? "[compaction] done; old context discarded"
        : "[compaction] done; continuing with the summarized context"
      : status === "aborted"
        ? "[compaction] aborted; keeping the current context"
        : `[compaction] failed${errorMessage !== undefined ? ` (${errorMessage})` : ""}${status === "fatal" ? "; the next context could not be opened" : ""}; keeping the current context${
            // retryable / legacy "failed": an old Trace's abandoned compaction.
            status === "retryable" ? "; retries at the next trigger" : ""
          }`) +
    (degraded
      ? ` (no full summary: a Trace hand-off note${errorMessage !== undefined ? ` — ${errorMessage}` : ""}${
          degraded.room
            ? "; too little room was left for compaction: correct the model's context_window or lower compaction.max_context_length"
            : ""
        })`
      : "") +
    (tokens ? ` · tokens ${tokens.total} (${tokens.delta})` : ""),

  mcpConnectStart: (servers) => `[mcp] connecting MCP servers (${servers.join(", ")})…`,

  mcpConnectStop: (durationMs, failures, aborted) =>
    aborted
      ? "[mcp] connect interrupted — reconnects on the next run"
      : failures.length === 0
        ? `[mcp] connected in ${(durationMs / 1000).toFixed(1)}s`
        : `[mcp] connected in ${(durationMs / 1000).toFixed(1)}s; unavailable: ${failures.map((f) => `${f.server} (${f.error})`).join(", ")}`,

  hookEvent: (name, decision, reason) =>
    `[hook] ${[name, decision, reason].filter(Boolean).join(" · ")}`,

  toolOutputElided: (hidden) => `… (+${hidden} lines, /verbose for full output)`,

  approvalDecision: (decision) =>
    decision === "allow"
      ? "✓ [approved]"
      : decision === "forbidden"
        ? "× [forbidden by policy]"
        : "× [denied]",

  steerLinePrefix: () => "↪ user: ",
};

/** The Chinese half of this contribution's messages. */
export const renderZh: RenderText = {
  taskStats: (s) =>
    `[统计信息] 上下文 ${s.context} (${s.contextDelta}) · tokens ${s.tokens} (${s.tokensDelta}) · 用时 ${s.elapsed} (${s.elapsedDelta})`,

  abortLabel: (abort) => {
    if (abort?.errorCode === "max_turns") return "[已停止]：已达到单次任务最大轮数";
    const cause =
      abort?.errorCode === "user_abort"
        ? "用户中断"
        : abort?.errorCode === "backoff_interrupted"
          ? "重试等待中被中断"
          : abort?.errorCode === "compaction_interrupted"
            ? "压缩过程中被中断"
            : (abort?.errorCode ?? abort?.reason ?? "");
    const text = cause ? `${cause}${abort?.errorMessage ? `：${abort.errorMessage}` : ""}` : "";
    return `[已中断]${text ? `：${text}` : ""}`;
  },

  llmFatalLabel: (errorMessage) => `[错误] 模型请求错误${errorMessage ? `：${errorMessage}` : ""}`,

  reconnectGaveUpLabel: (attempt, errorMessage) =>
    `[重试] 第 ${attempt} 次尝试后放弃${errorMessage ? `：${errorMessage}` : ""}`,

  reconnectLabel: (status, attempt, errorCode) =>
    `[重试] ${((kind) =>
      kind === "timeout"
        ? "连接超时或网络中断"
        : kind === "malformed"
          ? "响应不完整或无法解析"
          : kind === "network"
            ? "网络或服务暂时不可用"
            : kind === "image_rejected"
              ? "模型服务拒绝了本轮输入中的图片（已换成文字说明）"
              : kind === "failed"
                ? "模型服务返回错误"
                : kind === "output_truncated"
                  ? "模型输出达到输出上限，被截断"
                  : kind === "failed"
                    ? "模型服务返回错误"
                    : kind === "rejected"
                      ? "模型服务拒绝了请求"
                      : kind === "denied"
                        ? "服务商不为该账号或模型提供服务（余额、权限或模型不存在）"
                        : "请求失败")(errorCode ?? status)}，正在发起第 ${attempt} 次重试……`,

  compactionStart: (mode, reason) =>
    mode === "discard"
      ? `[压缩] 正在丢弃旧上下文（${reason}）……`
      : `[压缩] 正在总结压缩上下文（${reason}）……`,

  compactionStop: (mode, status, tokens, errorMessage, degraded) =>
    (status === "completed"
      ? mode === "discard"
        ? "[压缩] 完成，旧上下文已丢弃"
        : "[压缩] 完成，已切换到摘要后的新上下文"
      : status === "aborted"
        ? "[压缩] 已中断，保留当前上下文"
        : `[压缩] 失败${errorMessage !== undefined ? `（${errorMessage}）` : ""}${status === "fatal" ? "，未能开启新的上下文" : ""}，保留当前上下文${
            // retryable / legacy "failed": an old Trace's abandoned compaction.
            status === "retryable" ? "，下次触发时重试" : ""
          }`) +
    (degraded
      ? `（没有完整摘要，改用 Trace 交接说明${errorMessage !== undefined ? `：${errorMessage}` : ""}${
          degraded.room
            ? "；留给压缩的空间不足，请更正该模型的 context_window 或调低 compaction.max_context_length"
            : ""
        }）`
      : "") +
    (tokens ? ` · tokens ${tokens.total} (${tokens.delta})` : ""),

  mcpConnectStart: (servers) => `[mcp] 正在连接 MCP Server（${servers.join("、")}）……`,

  mcpConnectStop: (durationMs, failures, aborted) =>
    aborted
      ? "[mcp] 连接已中断，下次运行时重新连接"
      : failures.length === 0
        ? `[mcp] 连接完成，耗时 ${(durationMs / 1000).toFixed(1)}s`
        : `[mcp] 连接完成，耗时 ${(durationMs / 1000).toFixed(1)}s；不可用：${failures.map((f) => `${f.server}（${f.error}）`).join("、")}`,

  hookEvent: (name, decision, reason) =>
    `[钩子] ${[name, decision, reason].filter(Boolean).join(" · ")}`,

  toolOutputElided: (hidden) => `……（另有 ${hidden} 行，/verbose 显示完整输出）`,

  approvalDecision: (decision) =>
    decision === "allow" ? "✓ [已批准]" : decision === "forbidden" ? "× [策略禁止]" : "× [已拒绝]",

  steerLinePrefix: () => "↪ 用户: ",
};
