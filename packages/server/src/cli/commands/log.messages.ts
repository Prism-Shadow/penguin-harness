/**
 * The messages of the log command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface LogText {
  /** `penguin session log`: render a session's history, optionally following the live stream. */
  log: {
    desc: string;
    tail: string;
    follow: string;
    tailInvalid(value: string): string;
    /** --timeout without -f: there is no wait to bound. */
    timeoutNeedsFollow(): string;
  };
}

/** The English half of this contribution's messages. */
export const logEn: LogText = {
  log: {
    desc: "Render a session's history (defaults to the agent's most recent session)",
    tail: "Show only the last <n> entries",
    follow: "Keep following the live stream after the history",
    tailInvalid: (value) => `Invalid --tail value "${value}": expected a positive integer.`,
    timeoutNeedsFollow: () =>
      "--timeout only applies to -f/--follow: without it, session log never waits.",
  },
};

/** The Chinese half of this contribution's messages. */
export const logZh: LogText = {
  log: {
    desc: "渲染会话的历史消息（省略 session id 即取当前 Agent 最近一次会话）",
    tail: "只显示最后 <n> 条",
    follow: "渲染历史后继续跟随实时输出流",
    tailInvalid: (value) => `--tail 值「${value}」无效：应为正整数。`,
    timeoutNeedsFollow: () => "--timeout 只与 -f/--follow 搭配：不跟随时 session log 不等待。",
  },
};
