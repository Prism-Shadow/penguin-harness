/**
 * The messages of the ls command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface LsText {
  /** `penguin session ls`: session listing. */
  ls: {
    desc: string;
    /** -a/--all: include archived sessions. */
    all: string;
    /** --days: keep sessions last active within the trailing n calendar days (today = day 1). */
    days: string;
    daysInvalid(value: string): string;
    empty(projectId: string): string;
    colId(): string;
    colAgent(): string;
    colTitle(): string;
    colState(): string;
    colLast(): string;
    colWorkspace(): string;
    stateIdle(): string;
    stateRunning(): string;
  };
}

/** The English half of this contribution's messages. */
export const lsEn: LsText = {
  ls: {
    desc: "List the project's sessions (all agents unless --agent-id is given)",
    all: "Include archived sessions",
    days: "Only sessions last active within the trailing <n> calendar days (today counts as day 1)",
    daysInvalid: (value) => `Invalid --days value "${value}": expected a positive integer.`,
    empty: (projectId) => `No sessions in project ${projectId} yet.`,
    colId: () => "ID",
    colAgent: () => "AGENT",
    colTitle: () => "TITLE",
    colState: () => "STATE",
    colLast: () => "LAST",
    colWorkspace: () => "WORKSPACE",
    stateIdle: () => "idle",
    stateRunning: () => "running",
  },
};

/** The Chinese half of this contribution's messages. */
export const lsZh: LsText = {
  ls: {
    desc: "列出 Project 的会话（未指定 --agent-id 时覆盖全部 Agent）",
    all: "包含已归档会话",
    days: "只列最近 <n> 个自然日内活跃过的会话（今天算第 1 天）",
    daysInvalid: (value) => `--days 值「${value}」无效：应为正整数。`,
    empty: (projectId) => `Project ${projectId} 还没有会话。`,
    colId: () => "ID",
    colAgent: () => "AGENT",
    colTitle: () => "标题",
    colState: () => "状态",
    colLast: () => "最近活动",
    colWorkspace: () => "WORKSPACE",
    stateIdle: () => "空闲",
    stateRunning: () => "运行中",
  },
};
