/**
 * The messages of `penguin storage`, its CLI module's own group: the module hands both languages
 * to the CLI (index.ts), which adds the invocation's to the bundle the command receives. The
 * host's table does not carry them.
 */
import type { CliHostMessages } from "@prismshadow/penguin-library-cli/messages";
import type { StorageCategory, StorageCleanupKind } from "../types.js";

/** The bundle the storage commands read: the CLI host's, with the storage group. */
export type StorageMessages = CliHostMessages & StorageText;

export interface StorageText {
  storage: {
    desc: string;
    refresh: string;
    cleanDesc: string;
    olderThan: string;
    all: string;
    yes: string;
    /** The first line: what the scope is, what it uses, and when it was measured. */
    head(scope: "server" | "projects", used: string, measuredAt: string | null): string;
    measuringNote: string;
    /** Why the last measurement of a unit did not finish. */
    measureFailed(reason: string): string;
    categories: Record<StorageCategory, string>;
    projects: string;
    projectCol: string;
    agentCol: string;
    sizeCol: string;
    /** An admin's one row for the Projects they cannot open: how many, never their names. */
    otherProjects(count: number): string;
    serverFiles: string;
    entryCol: string;
    categoryCol: string;
    noProjects: string;
    /** The review table. */
    chosenCol: string;
    kindCol: string;
    whereCol: string;
    nameCol: string;
    changedCol: string;
    kinds: Record<StorageCleanupKind | "scratchpadIdle", string>;
    /** An orphan scratchpad has no chat any more: its row's name. */
    deletedChat: string;
    /** An idle scratchpad in a Project the caller cannot open: its title is not theirs to read. */
    hiddenChat: string;
    /** A chat with no title yet. */
    untitledChat: string;
    nothing: string;
    /** The dry run's last line. */
    wouldRemove(n: number, size: string, total: number): string;
    nothingChosen(total: number): string;
    removed(n: number, size: string, skipped: number, failed: number): string;
    /** `--yes` refused for an Agent's shell: what a person does instead. */
    humanRequired(): string;
    daysInvalid(raw: string): string;
    /** The plugin's server module is not running on this server. */
    unavailable(): string;
    errorLine(code: string, message: string): string;
  };
}

export const storageEn: StorageText = {
  storage: {
    desc: "Show what the data root holds, and clean what can be regenerated",
    refresh: "measure again before showing",
    cleanDesc:
      "Review what can be removed safely now (a dry run); --yes removes what the review ticks",
    olderThan:
      "an idle chat's scratchpad is one last active more than this many days ago (1–3650, default 7)",
    all: "with --yes, also remove what the review leaves unticked (idle chats' scratchpads, Agents' tool environments and app caches)",
    yes: "remove the chosen items instead of only listing them",
    head: (scope, used, measuredAt) =>
      `${scope === "server" ? "This server" : "My Projects"}: ${used} used${
        measuredAt === null ? "" : ` (measured ${measuredAt})`
      }`,
    measuringNote: "A measurement is still running; these are the figures before it.",
    measureFailed: (reason) => `The last measurement did not finish: ${reason}`,
    categories: {
      traces: "Traces",
      agentState: "Agent State",
      workspaces: "Temporary Workspaces",
      scratchpads: "Scratchpads",
      caches: "Caches",
      logs: "Logs",
      plugins: "Plugins",
      other: "Other",
    },
    projects: "By Project",
    projectCol: "PROJECT",
    agentCol: "AGENT",
    sizeCol: "SIZE",
    otherProjects: (count) => `Other users' Projects (${count})`,
    serverFiles: "Server files",
    entryCol: "ENTRY",
    categoryCol: "CATEGORY",
    noProjects: "No Project you can open.",
    chosenCol: "REMOVE",
    kindCol: "KIND",
    whereCol: "WHERE",
    nameCol: "NAME",
    changedCol: "CHANGED",
    kinds: {
      scratchpad: "scratchpad (deleted chat)",
      scratchpadIdle: "scratchpad (idle chat)",
      workspace: "temporary Workspace",
      agentCache: "Agent cache",
      serverCache: "server cache",
    },
    deletedChat: "Deleted chat",
    hiddenChat: "Another user's chat",
    untitledChat: "New chat",
    nothing: "Nothing to clean up.",
    wouldRemove: (n, size, total) =>
      `${n} of ${total} items would be removed (${size}). Run again with --yes to remove them.`,
    nothingChosen: (total) =>
      `${total} items can be removed, none of them ticked by default. Add --all to choose them too.`,
    removed: (n, size, skipped, failed) =>
      [
        `Removed ${n} items, freeing ${size}.`,
        skipped > 0 ? `${skipped} skipped: in use or gone.` : "",
        failed > 0 ? `${failed} could not be removed.` : "",
      ]
        .filter((part) => part !== "")
        .join(" "),
    humanRequired: () =>
      "Removing files takes a person's sign-in: run `penguin auth login` first, or clean up in Settings › Storage.",
    daysInvalid: (raw) =>
      `--older-than must be a whole number of days between 1 and 3650, got "${raw}".`,
    unavailable: () =>
      "Storage is off on this server: no Project lists the storage plugin, or an admin stopped it.",
    errorLine: (code, message) => `error: ${code}: ${message}`,
  },
};

export const storageZh: StorageText = {
  storage: {
    desc: "查看数据根目录占用的空间，清理可以重新生成的内容",
    refresh: "先重新测量再显示",
    cleanDesc: "审阅现在可以安全删除的内容（只列出）；加 --yes 删除审阅中勾选的项",
    olderThan: "闲置对话的草稿区：最近活动早于这么多天（1–3650，默认 7）",
    all: "与 --yes 同用时，连审阅中不勾选的项（闲置对话的草稿区、Agent 的工具环境与应用缓存）一起删除",
    yes: "删除选中的项，而不只是列出",
    head: (scope, used, measuredAt) =>
      `${scope === "server" ? "本机" : "我的 Project"}：已用 ${used}${
        measuredAt === null ? "" : `（测量于 ${measuredAt}）`
      }`,
    measuringNote: "测量仍在进行，下面是测量前的数字。",
    measureFailed: (reason) => `上次测量没有完成：${reason}`,
    categories: {
      traces: "轨迹",
      agentState: "Agent State",
      workspaces: "临时工作区",
      scratchpads: "草稿区",
      caches: "缓存",
      logs: "日志",
      plugins: "插件",
      other: "其他",
    },
    projects: "按 Project",
    projectCol: "Project",
    agentCol: "Agent",
    sizeCol: "大小",
    otherProjects: (count) => `其他用户的 Project（${count} 个）`,
    serverFiles: "服务端文件",
    entryCol: "条目",
    categoryCol: "类别",
    noProjects: "没有可以进入的 Project。",
    chosenCol: "删除",
    kindCol: "类型",
    whereCol: "位置",
    nameCol: "名称",
    changedCol: "最后改动",
    kinds: {
      scratchpad: "草稿区（已删除的对话）",
      scratchpadIdle: "草稿区（闲置的对话）",
      workspace: "临时工作区",
      agentCache: "Agent 缓存",
      serverCache: "服务端缓存",
    },
    deletedChat: "已删除的对话",
    hiddenChat: "其他用户的对话",
    untitledChat: "新对话",
    nothing: "没有可以清理的内容。",
    wouldRemove: (n, size, total) =>
      `${total} 项中的 ${n} 项将被删除（${size}）。加 --yes 再运行一次即可删除。`,
    nothingChosen: (total) => `有 ${total} 项可以删除，但都不在默认勾选之列。加 --all 一并选中。`,
    removed: (n, size, skipped, failed) =>
      [
        `已删除 ${n} 项，释放了 ${size}。`,
        skipped > 0 ? `${skipped} 项正在使用或已不在，已跳过。` : "",
        failed > 0 ? `${failed} 项没能删除。` : "",
      ].join(""),
    humanRequired: () =>
      "删除文件需要本人登录：先运行 `penguin auth login`，或者在 设置 › 存储空间 中清理。",
    daysInvalid: (raw) => `--older-than 应为 1 到 3650 之间的整数天数，收到的是「${raw}」。`,
    unavailable: () =>
      "本服务器未启用存储空间：没有 Project 列出 storage 插件，或管理员已将其停用。",
    errorLine: (code, message) => `error: ${code}: ${message}`,
  },
};
