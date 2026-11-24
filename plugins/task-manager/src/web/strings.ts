/**
 * The Task Manager's UI copy: its own zh and en tables, outside the app dictionaries. Read as `S`
 * inside this folder (the face's live view, `defineStrings` in @prismshadow/penguin-web-plugin,
 * answers from the table of the language on screen, so components keep reading `S.tasks.*` at
 * render time and a language switch still reaches them). A new string is added here, to both
 * tables, and nowhere else — `en` is typed by `zh`, so a key missing from it is a type error.
 */
import { defineStrings } from "@prismshadow/penguin-web-plugin";

const zh = {
  tasks: {
    title: "任务管理器",
    info: "正在运行的任务与会话：支持平铺视图（默认，优先显示运行中会话与最近 5 个空闲会话）与按机器/用户/应用分组的树形视图。单击会话可直接进入对话，右键可打开操作菜单。",
    /** Shown while the first answer is on its way. */
    loading: "正在读取任务树…",
    /** The first answer failed; `reason` is the server's words. */
    loadFailed: (reason: string): string => `无法读取任务树：${reason}`,
    /** Nothing runs: no session of the caller's Projects is listed. */
    empty: "现在没有会话。",
    emptyHint: "开一个会话（应用的或对话的都行），它就会出现在这里。",
    retry: "重试",
    /** View switcher in the page header. */
    viewFlat: "平铺",
    viewTree: "树形",
    /** The single-line machine summary strip at the top of the page. */
    machine: "机器",
    machineSummary: (users: number, apps: number): string => `${users} 位用户，${apps} 个应用`,
    totalTokens: "Tokens",
    requestCount: (n: number): string => `${n} 次请求`,
    totalCost: "费用",
    sessionCount: "会话",
    sessionBreakdown: (running: number, shownIdle: number, totalIdle: number): string =>
      totalIdle > shownIdle
        ? `${running} 个运行中，空闲显示 ${shownIdle}/${totalIdle}`
        : `${running} 个运行中，${shownIdle} 个空闲`,
    processCount: (n: number): string => `${n} 个进程`,
    /** Column headers of the monitor table. */
    colStatus: "状态",
    colTokens: "Token",
    colCpu: "CPU",
    colMemory: "内存",
    /** One user section and its app / direct-session groups. */
    userSessions: (n: number): string => `${n} 个会话`,
    appMeta: (project: string, agent: string): string => `${project} › ${agent}`,
    directSessions: "直接会话",
    sourceLabel: (source: string): string => `来源 ${source}`,
    /** One Session's row and context menu actions. */
    untitledSession: "新对话",
    running: "运行中",
    compacting: "压缩上下文",
    idle: "空闲",
    openSession: "打开会话",
    openInNewTab: "在新标签页中打开",
    expandProcesses: "展开进程列表",
    collapseProcesses: "收起进程列表",
    toggleProcesses: "展开或收起进程列表",
    copySessionId: "复制会话 ID",
    copiedSessionId: "已复制会话 ID",
    killSession: "终止并归档会话",
    killedSession: "已终止并归档会话",
    killSessionFailed: (reason: string): string => `无法终止并归档会话：${reason}`,
    /** Process context menu actions (signals and copy). */
    signalSigterm: "终止进程 (SIGTERM)",
    signalSigint: "中断进程 (SIGINT)",
    signalSighup: "挂起信号 (SIGHUP)",
    signalSigkill: "强制终止 (SIGKILL)",
    removeExitedProcess: "移除已退出进程",
    sentProcessSignal: (signal: string): string => `已发送信号 ${signal}`,
    removedExitedProcess: "已移除已退出进程",
    signalProcessFailed: (reason: string): string => `发送进程信号失败：${reason}`,
    copyProcessCommand: "复制命令",
    copiedProcessCommand: "已复制命令",
    copyProcessPid: "复制 PID",
    copiedProcessPid: "已复制 PID",
    /** Idle pagination controls. */
    showMoreIdle: (remaining: number): string => `展开更多空闲会话（还有 ${remaining} 个）`,
    showLessIdle: "收起空闲会话",
    /** One process row: its kind and its state. */
    toolCall: "工具",
    toolExecCommand: "命令",
    toolInputCommand: "命令输入",
    toolReadFile: "读取文件",
    toolWriteFile: "写入文件",
    toolEditFile: "编辑文件",
    toolRunSubagent: "子智能体",
    toolInputSubagent: "子智能体输入",
    background: "后台命令",
    pending: "待审批",
    exited: "已退出",
    /** A figure nobody could take (a pending call, a non-Linux host, an exited process). */
    unmeasured: "—",
    /** A Session's, or a level's, Tokens as one line. */
    tokens: (total: string, requests: number): string => `${total} tokens，${requests} 次请求`,
    /** Inline CPU and memory readings on a session or process row. */
    cpuUsage: (cpu: string): string => `CPU ${cpu}`,
    memoryUsage: (memory: string): string => `内存 ${memory}`,
    /** A pid's own line, when the process has one. */
    pid: (pid: number): string => `pid ${pid}`,
  },
};

const en: typeof zh = {
  tasks: {
    title: "Task Manager",
    info: "Active tasks and sessions: switch between the default flat view (running sessions first, plus the 5 most recent idle sessions) and the hierarchical machine → user → app tree view. Click a session to open it, or right-click for actions.",
    loading: "Reading the task tree…",
    loadFailed: (reason: string): string => `Could not read the task tree: ${reason}`,
    empty: "No sessions right now.",
    emptyHint: "Start a session — an app's or a chat's — and it appears here.",
    retry: "Retry",
    viewFlat: "Flat",
    viewTree: "Tree",
    machine: "Machine",
    machineSummary: (users: number, apps: number): string =>
      `${users} ${users === 1 ? "user" : "users"}, ${apps} ${apps === 1 ? "app" : "apps"}`,
    totalTokens: "Tokens",
    requestCount: (n: number): string => `${n} ${n === 1 ? "request" : "requests"}`,
    totalCost: "Cost",
    sessionCount: "Sessions",
    sessionBreakdown: (running: number, shownIdle: number, totalIdle: number): string =>
      totalIdle > shownIdle
        ? `${running} running, ${shownIdle}/${totalIdle} idle shown`
        : `${running} running, ${shownIdle} idle`,
    processCount: (n: number): string => `${n} ${n === 1 ? "process" : "processes"}`,
    colStatus: "Status",
    colTokens: "Tokens",
    colCpu: "CPU",
    colMemory: "Memory",
    userSessions: (n: number): string => `${n} ${n === 1 ? "session" : "sessions"}`,
    appMeta: (project: string, agent: string): string => `${project} › ${agent}`,
    directSessions: "Direct sessions",
    sourceLabel: (source: string): string => `source ${source}`,
    untitledSession: "New chat",
    running: "Running",
    compacting: "Compacting",
    idle: "Idle",
    openSession: "Open session",
    openInNewTab: "Open in new tab",
    expandProcesses: "Expand processes",
    collapseProcesses: "Collapse processes",
    toggleProcesses: "Toggle processes",
    copySessionId: "Copy session ID",
    copiedSessionId: "Copied session ID",
    killSession: "Kill & archive session",
    killedSession: "Killed and archived session",
    killSessionFailed: (reason: string): string => `Could not kill session: ${reason}`,
    signalSigterm: "Terminate (SIGTERM)",
    signalSigint: "Interrupt (SIGINT)",
    signalSighup: "Hangup (SIGHUP)",
    signalSigkill: "Force kill (SIGKILL)",
    removeExitedProcess: "Remove exited process",
    sentProcessSignal: (signal: string): string => `Sent ${signal} to process`,
    removedExitedProcess: "Removed exited process",
    signalProcessFailed: (reason: string): string => `Could not signal process: ${reason}`,
    copyProcessCommand: "Copy command",
    copiedProcessCommand: "Copied command",
    copyProcessPid: "Copy PID",
    copiedProcessPid: "Copied PID",
    showMoreIdle: (remaining: number): string => `Show more idle sessions (${remaining} more)`,
    showLessIdle: "Show fewer idle sessions",
    toolCall: "Tool",
    toolExecCommand: "Command",
    toolInputCommand: "Command input",
    toolReadFile: "Read file",
    toolWriteFile: "Write file",
    toolEditFile: "Edit file",
    toolRunSubagent: "Subagent",
    toolInputSubagent: "Subagent input",
    background: "Background",
    pending: "Pending",
    exited: "Exited",
    unmeasured: "—",
    tokens: (total: string, requests: number): string =>
      `${total} tokens, ${requests} ${requests === 1 ? "request" : "requests"}`,
    cpuUsage: (cpu: string): string => `CPU ${cpu}`,
    memoryUsage: (memory: string): string => `Mem ${memory}`,
    pid: (pid: number): string => `pid ${pid}`,
  },
};

export const S = defineStrings({ zh, en });
