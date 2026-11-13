/**
 * The messages of the sessionruntime command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

function headerEn(
  kind: "chat" | "run",
  version: string,
  agentId: string,
  workspace: string,
  model: string,
  server: string,
): string {
  return [
    `PenguinHarness ${kind} ${version}`,
    `Agent: ${agentId}`,
    `Workspace: ${workspace}`,
    `Model: ${model}`,
    `Server: ${server}`,
  ].join("\n");
}

function headerZh(
  kind: "chat" | "run",
  version: string,
  agentId: string,
  workspace: string,
  model: string,
  server: string,
): string {
  return [
    `PenguinHarness ${kind} ${version}`,
    `Agent：${agentId}`,
    `Workspace：${workspace}`,
    `模型：${model}`,
    `服务器：${server}`,
  ].join("\n");
}

export interface SessionRuntimeText {
  // —— Runtime output ——
  /**
   * Startup banner: product + subcommand + the CLI's build identity (`penguin --version`'s
   * string, which names a source build's commit) on the first line, then Agent / Workspace /
   * Model / Server each on its own line — the server as client.ts connectionLabel spells it.
   */
  header(
    kind: "chat" | "run",
    version: string,
    agentId: string,
    workspace: string,
    model: string,
    server: string,
  ): string;

  taskInterrupted(): string;

  /** Invalid token-budget value (chat `/goal:<budget>` or run `--goal <budget>`). */
  goalBudgetInvalid(value: string): string;

  /** Invalid `--thinking` / `/thinking` value (lists the selectable levels). */
  thinkingInvalid(value: string): string;

  /** 409 `task_in_progress` / `compacting`: the Session is busy (possibly driven from another surface). */
  switchModelBusy(): string;

  /** 409 `same_model`: the Session already runs on the target. */
  switchModelSame(model: string): string;

  /** 409 `model_not_configured`: the target is not in the Project config; names the `penguin config model` commands to list and add models. */
  switchModelNotConfigured(model: string, listCommand: string, addCommand: string): string;

  /** 409 `model_unavailable`: the target is configured but cannot be constructed (e.g. no credential); `detail` is the server's message, verbatim (may be empty). */
  switchModelUnavailable(model: string, detail: string): string;

  /** A switch that could not summarize handed the history over by its Trace path: the file the new model reads it from (absent for a Session that records no Trace). */
  switchModelHandedOver(tracePath?: string): string;

  /** Dim line announcing one goal round (printed before the round runs). */
  goalRound(round: number): string;

  /** Dim summary line after a goal ends: how it ended, rounds run, tokens consumed. */
  goalFinished(
    outcome: "complete" | "blocked" | "budget_limited" | "aborted",
    rounds: number,
    tokens: string,
  ): string;

  /** Approval prompt text (the tool call is already streamed above and directly precedes this prompt, so no index and no re-rendering). */
  approvePrompt(): string;

  /** Prompt for an invalid --approve mode. */
  approveModeInvalid(value: string): string;

  /** run/chat given only one of --model-id / --provider: a model reference is always an explicit pair, never a lookup. */
  modelRefIncomplete(): string;
}

/** The English half of this contribution's messages. */
export const sessionruntimeEn: SessionRuntimeText = {
  header: headerEn,

  taskInterrupted: () => "[current conversation interrupted]",

  goalBudgetInvalid: (value) =>
    `Invalid token budget "${value}". Use a positive number with an optional k/m suffix (500k, 2m).`,

  thinkingInvalid: (value) =>
    `Invalid thinking level "${value}". Use low, medium, high, xhigh, or max.`,

  switchModelBusy: () =>
    "[model switch] the Session is busy (a task or a compaction is running); switch once it finishes",

  switchModelSame: (model) => `[model switch] already on ${model}; nothing to switch`,

  switchModelNotConfigured: (model, listCommand, addCommand) =>
    `[model switch] ${model} is not in the Project config: ${listCommand} lists the configured models, ${addCommand} adds it`,

  switchModelUnavailable: (model, detail) =>
    `[model switch] ${model} is configured but cannot be used${detail ? `: ${detail}` : ""}`,

  switchModelHandedOver: (tracePath) =>
    `[model switch] no summary: the new model reads the earlier history from its Trace file${tracePath ? ` ${tracePath}` : ""}`,

  goalRound: (round) => `[goal] round ${round}`,

  goalFinished: (outcome, rounds, tokens) => {
    const label = {
      complete: "completed",
      blocked: "blocked (see the final reply for what it needs)",
      budget_limited: "stopped: token budget exhausted",
      aborted: "interrupted",
    }[outcome];
    return `[goal] ${label} · ${rounds} round${rounds === 1 ? "" : "s"} · tokens ${tokens}`;
  },

  approvePrompt: () => "? Approve this tool call? [Y/n] ",

  approveModeInvalid: (value) =>
    `Invalid approval mode "${value}". Use allow-all, deny-all, read-only, or always-ask.`,

  modelRefIncomplete: () =>
    "--model-id and --provider must be given together: a model reference is always an explicit (provider, model_id) pair. Omit both to use the Project default model.",
};

/** The Chinese half of this contribution's messages. */
export const sessionruntimeZh: SessionRuntimeText = {
  header: headerZh,

  taskInterrupted: () => "[已中断当前对话]",

  goalBudgetInvalid: (value) =>
    `无效的 token 预算 "${value}"：应为正数，可带 k/m 后缀（500k、2m）。`,

  thinkingInvalid: (value) => `无效的思考等级 "${value}"。请使用 low、medium、high、xhigh 或 max。`,

  switchModelBusy: () => "[切换模型] 会话正忙（任务或压缩进行中），请待其结束后再切换",

  switchModelSame: (model) => `[切换模型] 已在使用 ${model}，无需切换`,

  switchModelNotConfigured: (model, listCommand, addCommand) =>
    `[切换模型] Project 配置中没有 ${model}：${listCommand} 列出已配置的模型，${addCommand} 可添加它`,

  switchModelUnavailable: (model, detail) =>
    `[切换模型] ${model} 已配置但无法使用${detail ? `：${detail}` : ""}`,

  switchModelHandedOver: (tracePath) =>
    `[切换模型] 未生成摘要：新模型按需读取此前的 Trace 文件${tracePath ? ` ${tracePath}` : ""}`,

  goalRound: (round) => `[目标] 第 ${round} 轮`,

  goalFinished: (outcome, rounds, tokens) => {
    const label = {
      complete: "已完成",
      blocked: "受阻（所缺条件见最后一条回复）",
      budget_limited: "已停止：token 预算耗尽",
      aborted: "已中断",
    }[outcome];
    return `[目标] ${label} · 共 ${rounds} 轮 · tokens ${tokens}`;
  },

  approvePrompt: () => "? 批准此工具调用？[Y/n] ",

  approveModeInvalid: (value) =>
    `无效的审批模式 "${value}"。请使用 allow-all、deny-all、read-only 或 always-ask。`,

  modelRefIncomplete: () =>
    "--model-id 与 --provider 必须成对给出：模型引用始终是显式的 (provider, model_id) 组合。两者都不给则使用 Project 默认模型。",
};
