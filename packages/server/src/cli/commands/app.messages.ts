/**
 * The messages of the `penguin app` command, hosted by the server package and spread into the
 * CLI's message table (i18n.ts).
 */

export interface AppText {
  /** `penguin app`: inspect and drive the project's Apps (workbenches). */
  app: {
    desc: string;
    lsDesc: string;
    lsAll: string;
    infoDesc: string;
    reloadDesc: string;
    enableDesc: string;
    disableDesc: string;
    historyDesc: string;
    callDesc: string;
    callMethod: string;
    callData: string;
    appIdArg: string;
    callTargetArg: string;
    callPathArg: string;
    colId(): string;
    colTitle(): string;
    colStatus(): string;
    colTab(): string;
    colPlugin(): string;
    colRevision(): string;
    colCommit(): string;
    colSaved(): string;
    statusReady(): string;
    statusBuilding(): string;
    statusFailed(): string;
    statusDisabled(): string;
    hiddenTag(): string;
    empty(projectId: string): string;
    historyEmpty(appId: string): string;
    notFound(appId: string): string;
    reloaded(appId: string, revision: string): string;
    reloadFailed(appId: string, error: string): string;
    enabled(appId: string): string;
    disabled(appId: string): string;
    idMissing(): string;
    idLooksLikeSession(raw: string): string;
    idInvalid(raw: string): string;
    idMissingAgent(workbenchId: string): string;
    idAgentMismatch(appAgentId: string, flagAgentId: string): string;
    callPathRequired(): string;
    callPathInvalid(raw: string): string;
    callMethodInvalid(raw: string): string;
    callDataNotJson(detail: string): string;
    callDataOnBodylessMethod(method: string): string;
    fieldId(): string;
    fieldName(): string;
    fieldVersion(): string;
    fieldStatus(): string;
    fieldRevision(): string;
    fieldLoaded(): string;
    fieldTabs(): string;
    fieldAppCenter(): string;
    fieldSidebar(): string;
    fieldError(): string;
    fieldHints(): string;
    valueEnabled(): string;
    valueDisabled(): string;
    valueAgentDisabled(): string;
    valueShown(): string;
    valueHidden(): string;
  };
}

/** The English half of `penguin app` messages. */
export const appEn: AppText = {
  app: {
    desc: "Inspect and operate the project's apps (workbenches)",
    lsDesc: "List the project's apps (all agents unless --agent-id is given)",
    lsAll: "Include hidden and disabled apps",
    infoDesc: "Show details and current status of an app",
    reloadDesc: "Reload an app from disk and report any compile error or hints",
    enableDesc: "Enable an app",
    disableDesc: "Disable an app",
    historyDesc: "List recorded versions of an app",
    callDesc: "Send a request to an app's backend API (/api/*)",
    callMethod:
      "HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD; defaults to POST with --data, else GET)",
    callData: "JSON request body",
    appIdArg:
      "App id (<agentId>/<workbenchId>, or <workbenchId> with --agent-id / PENGUIN_AGENT_ID; defaults to PENGUIN_APP_ID)",
    callTargetArg: "App id (<agentId>/<workbenchId>), or /path directly when PENGUIN_APP_ID is set",
    callPathArg: "API path starting with / (e.g. /status)",
    colId: () => "ID",
    colTitle: () => "TITLE",
    colStatus: () => "STATUS",
    colTab: () => "TAB",
    colPlugin: () => "PLUGIN",
    colRevision: () => "REVISION",
    colCommit: () => "COMMIT",
    colSaved: () => "SAVED",
    statusReady: () => "ready",
    statusBuilding: () => "building",
    statusFailed: () => "failed",
    statusDisabled: () => "disabled",
    hiddenTag: () => "hidden",
    empty: (projectId) => `No apps in project ${projectId} yet.`,
    historyEmpty: (appId) => `No recorded versions for app ${appId} yet.`,
    notFound: (appId) => `No such app: ${appId} (run \`penguin app ls -a\` to see available apps).`,
    reloaded: (appId, revision) => `Reloaded ${appId} (${revision}).`,
    reloadFailed: (appId, error) => `Reload of ${appId} failed: ${error}`,
    enabled: (appId) => `Enabled ${appId}.`,
    disabled: (appId) => `Disabled ${appId}.`,
    idMissing: () =>
      "No app id given: pass <agentId>/<workbenchId>, or run inside an app session where PENGUIN_APP_ID is set.",
    idLooksLikeSession: (raw) =>
      `"${raw}" looks like a session id, not an app id. Pass <agentId>/<workbenchId> (see \`penguin app ls\`).`,
    idInvalid: (raw) =>
      `Invalid app id "${raw}": expected <agentId>/<workbenchId> (see \`penguin app ls\`).`,
    idMissingAgent: (workbenchId) =>
      `App id "${workbenchId}" has no agent prefix: pass <agentId>/${workbenchId}, or set --agent-id / PENGUIN_AGENT_ID.`,
    idAgentMismatch: (appAgentId, flagAgentId) =>
      `App id belongs to agent "${appAgentId}", which conflicts with --agent-id "${flagAgentId}".`,
    callPathRequired: () =>
      "Missing API path: pass `<app-id> /path`, or `/path` alone when PENGUIN_APP_ID is set.",
    callPathInvalid: (raw) =>
      `Invalid API path "${raw}": expected a path starting with "/" without traversal segments.`,
    callMethodInvalid: (raw) =>
      `Invalid HTTP method "${raw}": expected GET, POST, PUT, PATCH, DELETE, or HEAD.`,
    callDataNotJson: (detail) => `Invalid --data JSON: ${detail}`,
    callDataOnBodylessMethod: (method) => `--data cannot be used with HTTP ${method}.`,
    fieldId: () => "ID",
    fieldName: () => "Name",
    fieldVersion: () => "Version",
    fieldStatus: () => "Status",
    fieldRevision: () => "Revision",
    fieldLoaded: () => "Loaded",
    fieldTabs: () => "Tabs",
    fieldAppCenter: () => "App Center",
    fieldSidebar: () => "Sidebar",
    fieldError: () => "Error",
    fieldHints: () => "Hints",
    valueEnabled: () => "enabled",
    valueDisabled: () => "disabled",
    valueAgentDisabled: () => "agent switch off",
    valueShown: () => "shown",
    valueHidden: () => "hidden",
  },
};

/** The Chinese half of `penguin app` messages. */
export const appZh: AppText = {
  app: {
    desc: "查看与操作 Project 的应用（Workbench）",
    lsDesc: "列出 Project 的应用（未指定 --agent-id 时覆盖全部 Agent）",
    lsAll: "包含隐藏与已停用的应用",
    infoDesc: "查看某个应用的详情与当前状态",
    reloadDesc: "从磁盘重新加载应用并输出编译错误或提示",
    enableDesc: "启用应用",
    disableDesc: "停用应用",
    historyDesc: "列出应用的版本记录",
    callDesc: "向应用后端 API（/api/*）发起请求",
    callMethod: "HTTP 方法（GET、POST、PUT、PATCH、DELETE、HEAD；传 --data 时默认 POST，否则 GET）",
    callData: "JSON 请求体",
    appIdArg:
      "应用 id（<agentId>/<workbenchId>，或配合 --agent-id / PENGUIN_AGENT_ID 传 <workbenchId>；缺省取 PENGUIN_APP_ID）",
    callTargetArg: "应用 id（<agentId>/<workbenchId>），或在已设置 PENGUIN_APP_ID 时直接传 /path",
    callPathArg: "以 / 开头的 API 路径（例如 /status）",
    colId: () => "ID",
    colTitle: () => "标题",
    colStatus: () => "状态",
    colTab: () => "标签页",
    colPlugin: () => "插件",
    colRevision: () => "版本",
    colCommit: () => "提交",
    colSaved: () => "保存时间",
    statusReady: () => "就绪",
    statusBuilding: () => "构建中",
    statusFailed: () => "失败",
    statusDisabled: () => "已停用",
    hiddenTag: () => "隐藏",
    empty: (projectId) => `Project ${projectId} 还没有应用。`,
    historyEmpty: (appId) => `应用 ${appId} 还没有版本记录。`,
    notFound: (appId) => `找不到应用「${appId}」（可用 \`penguin app ls -a\` 查看可用应用）。`,
    reloaded: (appId, revision) => `已重新加载 ${appId}（${revision}）。`,
    reloadFailed: (appId, error) => `重新加载 ${appId} 失败：${error}`,
    enabled: (appId) => `已启用 ${appId}。`,
    disabled: (appId) => `已停用 ${appId}。`,
    idMissing: () =>
      "未指定应用 id：请传 <agentId>/<workbenchId>，或在带 PENGUIN_APP_ID 的应用会话内运行。",
    idLooksLikeSession: (raw) =>
      `「${raw}」看起来是会话 id，不是应用 id。请传 <agentId>/<workbenchId>（可用 \`penguin app ls\` 查看）。`,
    idInvalid: (raw) =>
      `应用 id「${raw}」无效：应为 <agentId>/<workbenchId>（可用 \`penguin app ls\` 查看）。`,
    idMissingAgent: (workbenchId) =>
      `应用 id「${workbenchId}」缺少 Agent 前缀：请传 <agentId>/${workbenchId}，或指定 --agent-id / PENGUIN_AGENT_ID。`,
    idAgentMismatch: (appAgentId, flagAgentId) =>
      `应用 id 属于 Agent「${appAgentId}」，与 --agent-id「${flagAgentId}」冲突。`,
    callPathRequired: () =>
      "缺少 API 路径：请传 `<app-id> /path`，或在已设置 PENGUIN_APP_ID 时直接传 `/path`。",
    callPathInvalid: (raw) => `API 路径「${raw}」无效：必须以「/」开头且不能包含路径穿越段。`,
    callMethodInvalid: (raw) =>
      `HTTP 方法「${raw}」无效：应为 GET、POST、PUT、PATCH、DELETE 或 HEAD。`,
    callDataNotJson: (detail) => `--data 不是合法的 JSON：${detail}`,
    callDataOnBodylessMethod: (method) => `HTTP ${method} 不能携带 --data 请求体。`,
    fieldId: () => "ID",
    fieldName: () => "名称",
    fieldVersion: () => "版本",
    fieldStatus: () => "状态",
    fieldRevision: () => "修订",
    fieldLoaded: () => "加载时间",
    fieldTabs: () => "标签页",
    fieldAppCenter: () => "应用中心",
    fieldSidebar: () => "侧边栏",
    fieldError: () => "错误",
    fieldHints: () => "提示",
    valueEnabled: () => "已启用",
    valueDisabled: () => "已停用",
    valueAgentDisabled: () => "Agent 总开关已关",
    valueShown: () => "显示",
    valueHidden: () => "隐藏",
  },
};
