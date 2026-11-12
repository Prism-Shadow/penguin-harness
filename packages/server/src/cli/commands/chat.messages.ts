/**
 * The messages of the chat command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

import { DEFAULT_CHAT_THINKING_LEVELS } from "@prismshadow/penguin-core";

const LEVEL_CHOICES = DEFAULT_CHAT_THINKING_LEVELS.join("|");

export interface ChatText {
  chat: {
    desc: string;
    resume: string;
    /** chat's --verbose: start with full tool output (collapsing off). */
    verbose: string;
  };

  /** `/thinking` display when the Session pins no level: the Agent's configured default applies. */
  chatThinkingConfigured(): string;

  chatHints(): string;

  confirmExit(): string;

  /** Acknowledgment printed when a line typed mid-run is queued as steering (echoes the text; delivered between turns). */
  steerQueued(text: string): string;

  /** Prompt shown when `/compact` has nothing to compact (session just started / two consecutive compactions). */
  compactNothing(): string;

  /** Feedback after `/clear`: the next message starts a fresh blank Session; the old Session stays on disk (its resume command is printed right above when it has a Trace record). */
  clearDone(): string;

  /** The chat's line under its banner while it has no Session yet: one is created at the first message. */
  chatNewConversation(): string;

  /** A command that needs a conversation (`/compact`, `/clear`) typed before the first message. */
  chatNoConversation(): string;

  /** Creating the Session for the first message failed: the message was not sent, and the next Enter sends it again. */
  chatMessageKept(): string;

  /** The banner's model when the chat names none and the Project's default model cannot be read. */
  chatProjectDefaultModel(): string;

  /** `/goal` usage error (missing objective / malformed command). */
  goalUsage(): string;

  /** `/thinking` with no argument: the level this Session is pinned to (by `--thinking` or `/thinking`), else the Agent's configured level. */
  thinkingCurrent(level: string): string;

  /** `/thinking <level>` accepted: the Session is pinned to it, effective from the next request; the reply advises compacting first — a mid-context change invalidates the provider's cached context (never written to the Agent config). */
  thinkingSet(level: string): string;

  /** `/thinking <level>` before the first message: the Session created then is pinned to it. */
  thinkingHeld(level: string): string;

  /** Bare `/switch-model`: the Session's current model (a formatted label) plus the usage; a switch compacts first. */
  switchModelCurrent(model: string): string;

  /** `/switch-model` with anything but exactly `<provider> <model_id>`. */
  switchModelUsage(): string;

  /** After `/switch-model` completed: the model the Session was on and the one it is on now (formatted labels). */
  switchModelDone(previous: string, next: string): string;

  /** `/switch-model <provider> <model_id>` before the first message: the Session created then runs on it. */
  switchModelHeld(model: string): string;

  /** `/verbose` toggled on: tool output renders in full from here on. */
  verboseOn(): string;

  /** `/verbose` toggled off: long tool output is collapsed again from here on. */
  verboseOff(): string;

  /** --resume is mutually exclusive with --workspace/--model-id/--provider (the resumed Session keeps its own); points at `/switch-model` for changing the model inside the chat. */
  resumeNoOverride(): string;

  /** --resume given without a session id, and the current Agent has no Session at all. */
  resumeNoSession(): string;

  /** One-line prompt shown after a successful resume, before rendering history. */
  resumedBanner(sessionId: string, messageCount: number): string;
  /** Dim line after a resumed Session's history when it is still running: the chat follows the run before its first prompt, and says what typing, Ctrl-C and /exit do meanwhile. */
  chatFollowingResumed(): string;
  /** Dim line where a run joined under way had more records than the server still holds: how many are not shown. */
  chatRunOmitted(count: number): string;
  /** Dim line when the server cannot hand over a run under way (an older server or machine): upgrade it. */
  chatServerTooOld(): string;

  /** Example resume command shown when the REPL exits (dim print; only when this session has a resumable record). */
  resumeHint(command: string): string;
}

/** The English half of this contribution's messages. */
export const chatEn: ChatText = {
  chat: {
    desc: "Open the interactive REPL",
    resume:
      "Resume an existing Session (defaults to the agent's most recent one); workspace and model follow the original Session (/switch-model changes the model inside the chat, compacting first)",
    verbose:
      "Show full tool output (by default long tool outputs are collapsed to their first and last lines; /verbose toggles it mid-chat)",
  },

  chatThinkingConfigured: () => "agent default",

  chatHints: () =>
    "Type a message to start a conversation; end a line with \\; typing while a task runs steers the agent; /goal runs a goal to completion; /compact to compact the context; /clear to start a fresh session; /thinking changes the thinking level; /switch-model <provider> <model_id> switches the model (compacting the context first); /verbose toggles full tool output; /exit to quit; and Ctrl-C interrupts the current conversation.",

  confirmExit: () => "Exit penguin? [y/N] ",

  steerQueued: (text) => `» steering queued (delivered with the next turn): ${text}`,

  compactNothing: () => "[compaction] nothing to compact yet",

  clearDone: () =>
    "[clear] your next message starts a fresh session (the previous one is kept and resumable)",

  chatNewConversation: () => "New conversation: it is created when you send your first message.",

  chatNoConversation: () =>
    "[chat] no conversation yet: it is created when you send your first message",

  chatMessageKept: () => "Your message was not sent: press Enter to send it again.",

  chatProjectDefaultModel: () => "the Project's default model",

  goalUsage: () => "Usage: /goal[:<budget>] <objective>  (e.g. /goal:500k fix all failing tests)",

  thinkingCurrent: (level) =>
    `[thinking] level: ${level} (this Session's) — change with /thinking <${LEVEL_CHOICES}>`,

  thinkingSet: (level) =>
    `[thinking] level pinned to ${level} for this Session, effective from the next request — changing it invalidates the model's cached context, so /compact first is recommended (the Agent config is unchanged)`,

  thinkingHeld: (level) =>
    `[thinking] the new conversation will be pinned to ${level} (the Agent config is unchanged)`,

  switchModelCurrent: (model) =>
    `[model switch] current model: ${model} — switch with /switch-model <provider> <model_id> (the context is compacted on the current model first)`,

  switchModelUsage: () =>
    "Usage: /switch-model <provider> <model_id>  (e.g. /switch-model deepseek deepseek-v4-pro; penguin config model list shows the configured models)",

  switchModelDone: (previous, next) => `[model switch] model: ${previous} → ${next}`,

  switchModelHeld: (model) => `[model switch] the new conversation will use ${model}`,

  verboseOn: () => "[verbose] on — tool output from here on shows in full",

  verboseOff: () =>
    "[verbose] off — long tool output from here on is collapsed (/verbose to toggle)",

  resumeNoOverride: () =>
    "--resume does not accept --workspace, --model-id or --provider: the resumed Session keeps its own. To change its model, run /switch-model <provider> <model_id> inside the chat (it compacts the context first).",

  resumeNoSession: () => "No session to resume: this agent has no recorded sessions yet.",

  resumedBanner: (sessionId, messageCount) =>
    `[resumed] ${sessionId} · ${messageCount} message${messageCount === 1 ? "" : "s"} in the current context`,
  chatFollowingResumed: () =>
    "[running] This Session is still running; following it here. Type to steer it, press Ctrl-C to stop it, or /exit to leave it running.",
  chatRunOmitted: (count) =>
    `… ${count} earlier record${count === 1 ? "" : "s"} of this run not shown (penguin session log shows them all)`,
  chatServerTooOld: () =>
    "This server cannot hand over a run under way; upgrade it. Until then the chat shows the history and what streams from here on.",

  resumeHint: (command) => `To continue this conversation: ${command}`,
};

/** The Chinese half of this contribution's messages. */
export const chatZh: ChatText = {
  chat: {
    desc: "打开交互式 REPL",
    resume:
      "恢复既有 Session 继续对话（缺省恢复当前 Agent 最近一次）；Workspace 与模型沿用原 Session（会话内可用 /switch-model 切换模型，会先压缩上下文）",
    verbose: "显示完整工具输出（缺省折叠过长的工具输出、只保留首尾数行；/verbose 可随时切换）",
  },

  chatThinkingConfigured: () => "Agent 配置值",

  chatHints: () =>
    "输入消息发起对话；行尾 \\ 续行；运行中输入可插话引导；/goal 以目标模式运行至完成；/compact 压缩上下文；/clear 开启全新会话；/thinking 调整思考等级；/switch-model <provider> <model_id> 切换模型（先压缩上下文）；/verbose 切换完整工具输出；/exit 退出；Ctrl-C 中断对话。",

  confirmExit: () => "确认退出 penguin？[y/N] ",

  steerQueued: (text) => `» 插话已排队（随下一轮送达）：${text}`,

  compactNothing: () => "[压缩] 当前上下文为空，无需压缩",

  clearDone: () => "[清空] 下一条消息将开启全新 Session（原会话仍保留，可恢复）",

  chatNewConversation: () => "新对话：发出第一条消息时才会创建。",

  chatNoConversation: () => "[对话] 还没有对话：发出第一条消息时才会创建",

  chatMessageKept: () => "消息没有发出：按回车键重新发送。",

  chatProjectDefaultModel: () => "Project 的默认模型",

  goalUsage: () => "用法：/goal[:<预算>] <目标>（例如 /goal:500k 修复所有失败的测试）",

  thinkingCurrent: (level) =>
    `[思考] 当前等级：${level}（本 Session）——用 /thinking <${LEVEL_CHOICES}> 修改`,

  thinkingSet: (level) =>
    `[思考] 本 Session 的等级已钉为 ${level}，下一轮请求起生效——更换思考等级会使模型缓存失效，建议先 /compact 压缩上下文（不改动 Agent 配置）`,

  thinkingHeld: (level) => `[思考] 新对话的等级将钉为 ${level}（不改动 Agent 配置）`,

  switchModelCurrent: (model) =>
    `[切换模型] 当前模型：${model}——用 /switch-model <provider> <model_id> 切换（会先用当前模型压缩上下文）`,

  switchModelUsage: () =>
    "用法：/switch-model <provider> <model_id>（例如 /switch-model deepseek deepseek-v4-pro；penguin config model list 列出已配置的模型）",

  switchModelDone: (previous, next) => `[切换模型] 模型：${previous} → ${next}`,

  switchModelHeld: (model) => `[切换模型] 新对话将使用 ${model}`,

  verboseOn: () => "[详细输出] 已开启——后续工具输出完整显示（/verbose 切换）",

  verboseOff: () => "[详细输出] 已关闭——后续过长的工具输出将折叠（/verbose 切换）",

  resumeNoOverride: () =>
    "--resume 不接受 --workspace、--model-id 与 --provider：均沿用原 Session。如需换模型，请在会话内使用 /switch-model <provider> <model_id>（会先压缩上下文）。",

  resumeNoSession: () => "没有可恢复的 Session：当前 Agent 还没有任何会话记录。",

  resumedBanner: (sessionId, messageCount) =>
    `[已恢复] ${sessionId} · 当前上下文共 ${messageCount} 条消息`,
  chatFollowingResumed: () =>
    "[运行中] 该 Session 仍在运行，已在此接上：输入即插话，Ctrl-C 中断，/exit 离开（Task 继续运行）。",
  chatRunOmitted: (count) =>
    `… 此次运行更早的 ${count} 条记录未显示（penguin session log 可查看全部）`,
  chatServerTooOld: () =>
    "该服务端不支持接续正在进行的运行，请升级服务端；在此之前只显示历史与此后的实时输出。",

  resumeHint: (command) => `继续本次对话：${command}`,
};
