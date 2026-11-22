/**
 * The Storage page's UI copy: its own zh and en tables, outside the app dictionaries. Read as `S`
 * inside this folder: the face's live view (`defineStrings` in @prismshadow/penguin-web-plugin)
 * answers from the table of the language on screen, so components keep reading `S.storage.*` at
 * render time and a language switch still reaches them. A new string is added here, to both
 * tables, and nowhere else — `en` is typed by `zh`, so a key missing from it is a type error.
 */
import { defineStrings } from "@prismshadow/penguin-web-plugin";

const zh = {
  /** Settings › Personal › Storage (this folder). */
  storage: {
    /** The page's name on the rail and over the pane, and its "?" beside the heading. */
    title: "存储空间",
    info: "这里显示数据根的空间占用，并清理可以再生的文件：草稿区、孤立的临时工作区与缓存；轨迹随对话一起删除。测量结果只保存在服务端的内存里，页面写明测量时刻；在别处删除对话不会更新这里的数字，按「刷新」重新测量。",
    /** The words the page shares with the rest of the app. */
    cancel: "取消",
    delete: "删除",
    loading: "加载中…",
    /** A chat with no title yet, as the app names it everywhere. */
    untitledChat: "新对话",
    /** The first section's title: the whole data root for an admin, the viewer's Projects for a member. */
    thisServer: "本机",
    myProjects: "我的 Project",
    used: (size: string): string => `已用 ${size}`,
    /** The size before anything has been measured. */
    notMeasured: "—",
    /** The bar's and its legend's accessible name. */
    usageLabel: "空间占用",
    measuredAt: (when: string): string => `测量于 ${when}`,
    measuring: "正在测量…",
    refresh: "刷新",
    /** One muted line under the bar: why the last measurement did not finish. */
    measureFailed: (reason: string): string => `上次测量没有完成：${reason}`,
    loadFailed: (reason: string): string => `无法读取空间占用：${reason}`,
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
    byProject: "按 Project",
    noProjects: "没有可以进入的 Project",
    /** An admin's one row for the Projects of other users: how many, never their names. */
    otherProjects: (n: number): string => `其他用户的 Project（${n} 个）`,
    byFolder: "按文件夹",
    copyPath: "复制路径",
    reveal: "在文件夹中显示",
    /** An admin's fold over the data root's top-level entries that are not Projects. */
    serverFiles: "服务端文件",
    cleanup: "清理",
    cleanTemp: "清理临时文件",
    cleanTempHint: "草稿区、孤立的临时工作区与缓存",
    cleanOld: "清理旧对话",
    cleanOldHint: "永久删除很久没有活动的已归档对话",
    manageSessions: "管理对话",
    manageSessionsHint: "按大小或最近活动查看对话，永久删除选中的",
    archived: "已归档对话",
    archivedHint: "恢复或删除已归档的对话",
    review: "审阅",
    open: "打开",
    /** Both review dialogs: the list's words, the footer, and the delete. */
    selectAll: "全选",
    deselectAll: "取消全选",
    count: (n: number): string => `${n} 项`,
    select: (title: string): string => `选择「${title}」`,
    selected: (n: number, size: string): string => `已选 ${n} 项，${size}`,
    actionFailed: (reason: string): string => `操作没有完成：${reason}`,
    /** The Clean up temporary files dialog. */
    temp: {
      /** The idle-age field sits in this sentence, between its two halves. */
      idleBefore: "闲置的草稿区：最近活动早于",
      idleAfter: "天",
      idleDays: "闲置天数",
      reviewing: "正在测量并审阅，可能需要一会儿…",
      orphanScratchpads: "已删除对话的草稿区",
      /** A scratchpad row whose chat is gone: it has no title, and its folder's name is an id. */
      deletedChat: "已删除的对话",
      /** An idle scratchpad row in a Project the admin cannot open: its title is not theirs to read. */
      hiddenChat: "其他用户的对话",
      idleScratchpads: "闲置对话的草稿区",
      idleScratchpadsNote:
        "删除后这些对话里附带的图片与文件不再显示，继续对话时模型也找不到它的计划与附件。",
      workspaces: "孤立的临时工作区",
      agentCaches: "Agent 缓存",
      agentCachesNote: "Agent 或它的应用下次需要时会重新生成。",
      serverCaches: "服务端缓存",
      empty: "没有可以清理的文件",
      reviewFailed: (reason: string): string => `无法审阅：${reason}`,
      confirmTitle: (n: number): string => `删除 ${n} 项？`,
      confirmBody: (n: number, size: string): string =>
        `所选的 ${n} 项将被永久删除，释放约 ${size}。`,
      /** The toast after a cleanup: what went and what it freed, then what was left and why. */
      summary: (removed: number, size: string, skipped: number, failed: number): string =>
        [
          removed > 0 ? `已删除 ${removed} 项，释放了 ${size}` : "",
          skipped > 0 ? `${skipped} 项正在使用或已不在，已跳过` : "",
          failed > 0 ? `${failed} 项没能删除` : "",
        ]
          .filter((part) => part !== "")
          .join("。"),
    },
    /** The Clean up old chats and Manage chats dialog. */
    chats: {
      agentFilter: "Agent",
      allAgents: "全部 Agent",
      listingFilter: "归档",
      listing: { all: "全部", archived: "已归档", active: "未归档" },
      /** The last-active field sits in this sentence, between its two halves; blank means any time. */
      olderBefore: "最近活动早于",
      olderAfter: "天",
      olderDays: "最近活动早于的天数",
      olderAny: "不限",
      sortFilter: "排序",
      sort: { size: "大小", age: "最近活动" },
      group: "对话",
      archived: "已归档",
      running: "正在运行",
      truncated: (n: number): string => `只列出了前 ${n} 条`,
      empty: "没有符合条件的对话",
      loadFailed: (reason: string): string => `无法读取对话：${reason}`,
      confirmTitle: (n: number): string => (n === 1 ? "删除对话？" : `删除 ${n} 个对话？`),
      confirmBody: (n: number, size: string): string =>
        `所选的 ${n} 个对话连同它们的 Trace、草稿区与子会话将被永久删除，释放约 ${size}。`,
      deleted: (n: number): string => `已删除 ${n} 个对话`,
    },
  },

  /** The codes the storage routes answer with that the app has no words for; read after its own. */
  apiErrors: {
    desktop_shell_only: "只能在桌面应用自己的窗口里显示文件夹。",
  },
};

const en: typeof zh = {
  storage: {
    /** The page's name on the rail and over the pane, and its "?" beside the heading. */
    title: "Storage",
    info: "What the data root holds, and a cleanup of what can be regenerated: scratchpads, orphaned temporary workspaces and caches; Traces go with their chats. The measurement lives only in the server's memory and the page says when it was taken; a chat deleted elsewhere does not change the numbers here until you press Refresh.",
    cancel: "Cancel",
    delete: "Delete",
    loading: "Loading…",
    untitledChat: "New chat",
    thisServer: "This server",
    myProjects: "My Projects",
    used: (size: string): string => `${size} used`,
    notMeasured: "—",
    usageLabel: "Storage used",
    measuredAt: (when: string): string => `Measured ${when}`,
    measuring: "Measuring…",
    refresh: "Refresh",
    measureFailed: (reason: string): string => `The last measurement did not finish: ${reason}`,
    loadFailed: (reason: string): string => `Could not read the storage usage: ${reason}`,
    categories: {
      traces: "Traces",
      agentState: "Agent State",
      workspaces: "Temporary workspaces",
      scratchpads: "Scratchpads",
      caches: "Caches",
      logs: "Logs",
      plugins: "Plugins",
      other: "Other",
    },
    byProject: "By Project",
    noProjects: "No Projects you can open",
    otherProjects: (n: number): string =>
      n === 1 ? "1 Project of other users" : `${n} Projects of other users`,
    byFolder: "By folder",
    copyPath: "Copy path",
    reveal: "Show in folder",
    serverFiles: "Server files",
    cleanup: "Clean up",
    cleanTemp: "Clean up temporary files",
    cleanTempHint: "Scratchpads, orphaned temporary workspaces and caches",
    cleanOld: "Clean up old chats",
    cleanOldHint: "Delete archived chats that have had no activity for a long time",
    manageSessions: "Manage chats",
    manageSessionsHint: "See chats by size or last activity, and delete the ones you choose",
    archived: "Archived chats",
    archivedHint: "Restore or delete archived chats",
    review: "Review",
    open: "Open",
    selectAll: "Select all",
    deselectAll: "Deselect all",
    count: (n: number): string => (n === 1 ? "1 item" : `${n} items`),
    select: (title: string): string => `Select ${title}`,
    selected: (n: number, size: string): string => `${n} selected, ${size}`,
    actionFailed: (reason: string): string => `That did not finish: ${reason}`,
    temp: {
      idleBefore: "Idle scratchpads: last active more than",
      idleAfter: "days ago",
      idleDays: "Idle days",
      reviewing: "Measuring and reviewing, this can take a moment…",
      orphanScratchpads: "Scratchpads of deleted chats",
      deletedChat: "Deleted chat",
      hiddenChat: "Another user's chat",
      idleScratchpads: "Scratchpads of idle chats",
      idleScratchpadsNote:
        "Images and files attached in these chats stop showing, and a continued chat can no longer find its plans and attachments.",
      workspaces: "Orphaned temporary workspaces",
      agentCaches: "Agent caches",
      agentCachesNote: "The Agent or its apps make them again the next time they are needed.",
      serverCaches: "Server caches",
      empty: "Nothing to clean up",
      reviewFailed: (reason: string): string => `Could not review: ${reason}`,
      confirmTitle: (n: number): string => (n === 1 ? "Delete 1 item?" : `Delete ${n} items?`),
      confirmBody: (n: number, size: string): string =>
        n === 1
          ? `The chosen item will be deleted permanently, freeing about ${size}.`
          : `The ${n} chosen items will be deleted permanently, freeing about ${size}.`,
      summary: (removed: number, size: string, skipped: number, failed: number): string =>
        [
          removed > 0
            ? `Deleted ${removed === 1 ? "1 item" : `${removed} items`}, freed ${size}`
            : "",
          skipped > 0
            ? skipped === 1
              ? "1 item is in use or gone and was skipped"
              : `${skipped} items are in use or gone and were skipped`
            : "",
          failed > 0
            ? failed === 1
              ? "1 item could not be deleted"
              : `${failed} items could not be deleted`
            : "",
        ]
          .filter((part) => part !== "")
          .join(". "),
    },
    chats: {
      agentFilter: "Agent",
      allAgents: "All Agents",
      listingFilter: "Archive",
      listing: { all: "All", archived: "Archived", active: "Not archived" },
      olderBefore: "Last active more than",
      olderAfter: "days ago",
      olderDays: "Days since last activity",
      olderAny: "Any",
      sortFilter: "Sort",
      sort: { size: "Size", age: "Last activity" },
      group: "Chats",
      archived: "Archived",
      running: "Running",
      truncated: (n: number): string => `Only the first ${n} are listed`,
      empty: "No chats match",
      loadFailed: (reason: string): string => `Could not read the chats: ${reason}`,
      confirmTitle: (n: number): string => (n === 1 ? "Delete chat?" : `Delete ${n} chats?`),
      confirmBody: (n: number, size: string): string =>
        n === 1
          ? `The chosen chat will be deleted permanently with its Trace, scratchpad and subagents, freeing about ${size}.`
          : `The ${n} chosen chats will be deleted permanently with their Traces, scratchpads and subagents, freeing about ${size}.`,
      deleted: (n: number): string => (n === 1 ? "Deleted 1 chat" : `Deleted ${n} chats`),
    },
  },

  apiErrors: {
    desktop_shell_only: "Showing a folder is available from the desktop app's own window.",
  },
};

export const S = defineStrings({ zh, en });
