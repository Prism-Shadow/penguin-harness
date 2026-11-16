/**
 * The messages of the schedule command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface ScheduleText {
  /** `penguin schedule`: scheduled-task listing and management (a validated writer over the schedules API; the TOML file stays the single source of truth). */
  schedule: {
    desc: string;
    lsDesc: string;
    addDesc: string;
    updateDesc: string;
    rmDesc: string;
    /** --prompt: the text the firing sends. */
    prompt: string;
    /** --start-at: first fire time, ISO 8601 — or the literal `now` for the current instant. */
    startAt: string;
    /** --period: fixed interval (30m / 12h / 1d / 7d, minimum 5m); omitted = one-shot. */
    period: string;
    /** --end-at: stop firing after this instant (ISO 8601). */
    endAt: string;
    /** --session-id: bind firings to one session (excludes the new-session form). */
    sessionId: string;
    /** --workspace: new-session mode's workspace (omitted = a temp workspace per firing). */
    workspace: string;
    /** add's --disabled: opt out of the CLI's enabled-by-default divergence. */
    disabledOpt: string;
    /** update's --enable / --disable pair. */
    enableOpt: string;
    disableOpt: string;
    enableDisableConflict(): string;
    /** --session-id given together with the new-session form: the target is one or the other. */
    targetConflict(): string;
    /** Confirmation after add/update; nextFireAt is absent for done/disabled/invalid tasks. */
    written(name: string, enabledText: string, nextFireAt: string | undefined): string;
    removed(name: string): string;
    enabled(): string;
    disabled(): string;
    /** Period column for a one-off task (no period configured). */
    oneShot(): string;
    /** Target column when the schedule creates a new session each firing. */
    newSession(): string;
    empty(projectId: string): string;
    colName(): string;
    colEnabled(): string;
    colStartAt(): string;
    colPeriod(): string;
    colTarget(): string;
    colLastFired(): string;
    colStatus(): string;
  };
}

/** The English half of this contribution's messages. */
export const scheduleEn: ScheduleText = {
  schedule: {
    desc: "Manage scheduled tasks",
    lsDesc: "List the project's scheduled tasks (all agents unless --agent-id is given)",
    addDesc:
      "Create a scheduled task (writes the schedule file through the API; enabled by default — use --disabled to opt out)",
    updateDesc:
      "Update a scheduled task (read-modify-write: unspecified fields keep their stored values)",
    rmDesc: "Delete a scheduled task (no prompt; the server's owner authorization applies)",
    prompt: "The text each firing sends",
    startAt:
      "First fire time (ISO 8601), or the literal `now` for the current instant; a one-shot task needs a future time, so `now` only works with --period",
    period: "Fixed interval, minimum 5m (e.g. 30m, 12h, 1d, 7d); omitted = one-shot",
    endAt: "Stop firing after this instant (ISO 8601)",
    sessionId: "Bind firings to one session (excludes --workspace / the model pair)",
    workspace: "New-session mode: workspace for each firing (omitted = a temp workspace)",
    disabledOpt: "Create the task disabled (the CLI default is enabled)",
    enableOpt: "Enable the task",
    disableOpt: "Disable the task",
    enableDisableConflict: () => "--enable and --disable are mutually exclusive.",
    targetConflict: () =>
      "--session-id and the new-session form (--workspace / --model-id / --provider) are mutually exclusive: the target is one or the other.",
    written: (name, enabledText, nextFireAt) =>
      `Schedule ${name} written (${enabledText}${nextFireAt !== undefined ? `, next fire ${nextFireAt}` : ""}).`,
    removed: (name) => `Schedule ${name} removed.`,
    enabled: () => "on",
    disabled: () => "off",
    oneShot: () => "once",
    newSession: () => "new session",
    empty: (projectId) => `No scheduled tasks in project ${projectId}.`,
    colName: () => "NAME",
    colEnabled: () => "ENABLED",
    colStartAt: () => "START",
    colPeriod: () => "PERIOD",
    colTarget: () => "TARGET",
    colLastFired: () => "LAST FIRED",
    colStatus: () => "STATUS",
  },
};

/** The Chinese half of this contribution's messages. */
export const scheduleZh: ScheduleText = {
  schedule: {
    desc: "管理定时任务",
    lsDesc: "列出 Project 的定时任务（未指定 --agent-id 时覆盖全部 Agent）",
    addDesc: "创建定时任务（经 API 写入任务文件；缺省即启用——用 --disabled 关闭）",
    updateDesc: "更新定时任务（读改写：未指定的字段保留存储值）",
    rmDesc: "删除定时任务（不做确认；服务端的 owner 授权照旧生效）",
    prompt: "每次触发要发送的内容",
    startAt:
      "首次触发时刻（ISO 8601），或字面量 `now` 表示当前时刻；一次性任务须用未来时刻，`now` 只适用于带 --period 的任务",
    period: "固定间隔，下限 5m（如 30m、12h、1d、7d）；省略即一次性任务",
    endAt: "此时刻之后不再触发（ISO 8601）",
    sessionId: "绑定到某个会话触发（与 --workspace / 模型对互斥）",
    workspace: "新建会话模式：每次触发所用 Workspace（省略即自动创建临时工作区）",
    disabledOpt: "以停用状态创建（CLI 缺省为启用）",
    enableOpt: "启用该任务",
    disableOpt: "停用该任务",
    enableDisableConflict: () => "--enable 与 --disable 互斥。",
    targetConflict: () =>
      "--session-id 与新建会话形式（--workspace / --model-id / --provider）互斥：目标二选一。",
    written: (name, enabledText, nextFireAt) =>
      `定时任务 ${name} 已写入（${enabledText}${nextFireAt !== undefined ? `，下次触发 ${nextFireAt}` : ""}）。`,
    removed: (name) => `定时任务 ${name} 已删除。`,
    enabled: () => "开",
    disabled: () => "关",
    oneShot: () => "一次性",
    newSession: () => "新建会话",
    empty: (projectId) => `Project ${projectId} 没有定时任务。`,
    colName: () => "名称",
    colEnabled: () => "启用",
    colStartAt: () => "开始时刻",
    colPeriod: () => "周期",
    colTarget: () => "目标",
    colLastFired: () => "最近触发",
    colStatus: () => "状态",
  },
};
