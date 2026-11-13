/**
 * The messages of the agent command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface AgentText {
  /** `penguin agent`: agent listing and creation. */
  agent: {
    desc: string;
    lsDesc: string;
    createDesc: string;
    createId: string;
    createName: string;
    createDescription: string;
    /** --author: who is creating the agent (user, agent or company); defaults to agent inside a Session. */
    createAuthor: string;
    /** --author named none of the three. */
    createAuthorInvalid(value: string): string;
    /** --plugins: comma-separated library plugin names to seed the new agent with. */
    createPlugins: string;
    created(agentId: string, projectId: string): string;
    colId(): string;
    colName(): string;
    colSessions(): string;
    colDescription(): string;
    /** `penguin agent api …`: an agent's public API (this server's switches, approval mode and keys). */
    apiDesc: string;
    apiStatusDesc: string;
    apiEnableDesc: string;
    apiDisableDesc: string;
    apiSetDesc: string;
    /** --open / --no-open: keyless access on or off. */
    apiOpen: string;
    apiNoOpen: string;
    /** --approve on enable/set: the mode API conversations are created with. */
    apiApprove: string;
    /** `set` given nothing to change. */
    apiNothingToSet(): string;
    apiKeysDesc: string;
    apiKeysLsDesc: string;
    apiKeysCreateDesc: string;
    apiKeysRmDesc: string;
    /** --name of `keys create`. */
    apiKeyName: string;
    apiServerDesc: string;
    /** `server <state>` given something other than on/off. */
    apiServerStateInvalid(value: string): string;
    /** The status block: its heading, then one labelled line per fact. */
    apiStatusTitle(agentRef: string): string;
    apiFieldEnabled(): string;
    apiFieldOpen(): string;
    apiFieldApproval(): string;
    apiFieldBaseUrl(): string;
    apiFieldAgentId(): string;
    apiFieldKeys(): string;
    apiFieldServer(): string;
    apiYes(): string;
    apiNo(): string;
    apiServerOn(): string;
    apiServerOff(): string;
    /** `keys ls` columns, and the line for an agent with none. */
    apiColKeyId(): string;
    apiColKeyName(): string;
    apiColPrefix(): string;
    apiColCreated(): string;
    apiColLastUsed(): string;
    apiKeyNever(): string;
    apiKeysEmpty(agentRef: string): string;
    /** stderr beside the bare secret on stdout. */
    apiKeyCreated(name: string, prefix: string, agentRef: string): string;
    apiKeyDeleted(keyId: string, agentRef: string): string;
    /** After `server on|off`. */
    apiServerSet(on: boolean): string;
    /** A write refused 403 human_required: it carried the local API token, and no stored sign-in stood in. */
    apiSignInRequired(): string;
    /** On stderr after `--open` switched keyless access on. */
    apiOpenWarning(): string;
    /** `penguin agent export|import`: an Agent as a zip of its directory. */
    exportDesc: string;
    exportOut: string;
    exportNoSkills: string;
    exportNoHooks: string;
    exportNoMemory: string;
    exportNoWorkbenches: string;
    exportNoWorkbenchData: string;
    exportSchedules: string;
    exportTraces: string;
    exported(agentId: string, file: string): string;
    importDesc: string;
    importAgentId: string;
    importOverwrite: string;
    imported(
      mode: "created" | "overwritten",
      agentId: string,
      projectId: string,
      version: number,
      sessions: number,
    ): string;
    importBackup(file: string): string;
    importSkipped(sessionIds: readonly string[]): string;
    /** After a 409 `agent_exists`. */
    importOverwriteHint(): string;
    importUnreadable(file: string): string;
    importTooLarge(dir: string): string;
  };
}

/** The English half of this contribution's messages. */
export const agentEn: AgentText = {
  agent: {
    desc: "Manage the project's agents",
    lsDesc: "List the project's agents",
    createDesc: "Create an agent",
    createId: "Agent id (directory name; letters, digits, underscores)",
    createName: "Display name (defaults to the id)",
    createDescription: "Description",
    createAuthor:
      "Who is creating the agent: user, agent or company (default: agent inside a session, otherwise user)",
    createAuthorInvalid: (value) => `Unknown --author "${value}": use user, agent or company.`,
    createPlugins:
      "Library plugins to preinstall, comma-separated (e.g. software-development,goal)",
    created: (agentId, projectId) => `Agent ${agentId} created in project ${projectId}.`,
    colId: () => "ID",
    colName: () => "NAME",
    colSessions: () => "SESSIONS",
    colDescription: () => "DESCRIPTION",
    apiDesc: "Manage an agent's public API: the switch, keyless access, approval mode and keys",
    apiStatusDesc: "Show the agent's API settings, its address and the server-wide switch",
    apiEnableDesc: "Turn the agent's API on",
    apiDisableDesc: "Turn the agent's API off (settings and keys are kept)",
    apiSetDesc: "Change keyless access or the approval mode without turning the API on or off",
    apiOpen: "Allow keyless access: anything that can reach the server can talk to the agent",
    apiNoOpen: "Require a key",
    apiApprove:
      "Approval mode new API conversations start with: allow-all, deny-all, read-only or always-ask (asks go to the caller)",
    apiNothingToSet: () => "Nothing to change: pass --open, --no-open or --approve <mode>.",
    apiKeysDesc: "Manage the agent's API keys",
    apiKeysLsDesc: "List the agent's API keys",
    apiKeysCreateDesc: "Create an API key; the key is printed once, alone on stdout",
    apiKeysRmDesc: "Delete an API key; programs using it are refused from then on",
    apiKeyName: "Name of the key (1-64 characters)",
    apiServerDesc: "Turn the Agent API on or off for the whole server (admins only)",
    apiServerStateInvalid: (value) => `Invalid state "${value}": expected on or off.`,
    apiStatusTitle: (agentRef) => `Agent API of ${agentRef}`,
    apiFieldEnabled: () => "Enabled",
    apiFieldOpen: () => "Keyless access",
    apiFieldApproval: () => "Approval mode",
    apiFieldBaseUrl: () => "Base URL",
    apiFieldAgentId: () => "Agent ID",
    apiFieldKeys: () => "Keys",
    apiFieldServer: () => "Server switch",
    apiYes: () => "yes",
    apiNo: () => "no",
    apiServerOn: () => "on",
    apiServerOff: () => "off (every API request is refused)",
    apiColKeyId: () => "ID",
    apiColKeyName: () => "NAME",
    apiColPrefix: () => "PREFIX",
    apiColCreated: () => "CREATED",
    apiColLastUsed: () => "LAST USED",
    apiKeyNever: () => "never",
    apiKeysEmpty: (agentRef) => `${agentRef} has no API keys.`,
    apiKeyCreated: (name, prefix, agentRef) =>
      `Created key "${name}" (${prefix}…) for ${agentRef}. It is shown once, above; store it now.`,
    apiKeyDeleted: (keyId, agentRef) => `Deleted key ${keyId} of ${agentRef}.`,
    apiServerSet: (on) =>
      on
        ? "The Agent API is on for this server."
        : "The Agent API is off for this server: every request is refused; per-agent settings and keys are kept.",
    apiSignInRequired: () =>
      "Sign in first: `penguin auth login` (or `penguin auth token` on the server's machine). The local API token may not change an Agent's exposure.",
    apiOpenWarning: () =>
      "Warning: keyless access is on. Anything that can reach this server's address can now talk to the agent without a key, on the Project's models and credentials. Keep it on only for a server that listens on loopback; `--no-open` turns it off.",
    exportDesc: "Export an agent as a zip of its directory (the vault never travels)",
    exportOut: "File to write (defaults to the server's name for it, <agent-id>-<yyyymmdd>.zip)",
    exportNoSkills: "Leave out the skills",
    exportNoHooks: "Leave out the hook packages",
    exportNoMemory: "Leave out the memory",
    exportNoWorkbenches: "Leave out the workbenches",
    exportNoWorkbenchData: "Take each workbench's source without its data (state.json)",
    exportSchedules: "Take the scheduled tasks (once imported, they run on their schedule)",
    exportTraces:
      "Sessions to take: none, last:<N> (1-500 by last activity, subagents with their parent) or <yyyy-mm-dd>..<yyyy-mm-dd>",
    exported: (agentId, file) => `Exported agent ${agentId} to ${file}.`,
    importDesc: "Import an agent from a zip, a tar.gz snapshot package or an agent directory",
    importAgentId: "Agent id (defaults to the zip's top-level folder or the directory's name)",
    importOverwrite:
      "Replace the State of the agent with that id (project owners only), after a backup snapshot",
    imported: (mode, agentId, projectId, version, sessions) =>
      `${mode === "created" ? "Created" : "Overwrote"} agent ${agentId} in project ${projectId} (version ${version}); ${sessions} ${sessions === 1 ? "Session" : "Sessions"} imported.`,
    importBackup: (file) => `The replaced State is backed up as snapshots/${file}.`,
    importSkipped: (ids) =>
      `Skipped ${ids.length === 1 ? "a Session" : `${ids.length} Sessions`} this install already has: ${ids.join(", ")}`,
    importOverwriteHint: () =>
      "Pass --agent-id <id> to import under another id, or --overwrite to replace this agent (project owners only).",
    importUnreadable: (file) => `Cannot read ${file}.`,
    importTooLarge: (dir) =>
      `${dir} is past what an import takes (20,000 files, 512MB, 64MB zipped); nothing was sent.`,
  },
};

/** The Chinese half of this contribution's messages. */
export const agentZh: AgentText = {
  agent: {
    desc: "管理 Project 的 Agent",
    lsDesc: "列出 Project 的 Agent",
    createDesc: "创建 Agent",
    createId: "Agent id（即目录名；字母、数字、下划线）",
    createName: "显示名（缺省同 id）",
    createDescription: "描述",
    createAuthor: "由谁创建：user、agent 或 company（缺省：在会话内为 agent，否则为 user）",
    createAuthorInvalid: (value) => `未知的 --author「${value}」：请用 user、agent 或 company。`,
    createPlugins: "预装的插件库插件，逗号分隔（如 software-development,goal）",
    created: (agentId, projectId) => `已在 Project ${projectId} 创建 Agent ${agentId}。`,
    colId: () => "ID",
    colName: () => "名称",
    colSessions: () => "会话数",
    colDescription: () => "描述",
    apiDesc: "管理 Agent 的对外 API：开关、无密钥访问、审批模式与密钥",
    apiStatusDesc: "查看 Agent 的 API 设置、访问地址与服务器总开关",
    apiEnableDesc: "开启 Agent 的 API 访问",
    apiDisableDesc: "关闭 Agent 的 API 访问（设置与密钥保留）",
    apiSetDesc: "更改无密钥访问或审批模式，不改变开关",
    apiOpen: "允许无密钥访问：任何能访问服务器的程序都能与该 Agent 对话",
    apiNoOpen: "要求密钥",
    apiApprove:
      "新建 API 会话使用的审批模式：allow-all、deny-all、read-only 或 always-ask（需要确认时发给调用方）",
    apiNothingToSet: () => "没有要更改的内容：请给出 --open、--no-open 或 --approve <mode>。",
    apiKeysDesc: "管理 Agent 的 API 密钥",
    apiKeysLsDesc: "列出 Agent 的 API 密钥",
    apiKeysCreateDesc: "新建 API 密钥；密钥只输出一次，单独占据 stdout",
    apiKeysRmDesc: "删除 API 密钥；使用它的程序此后会被拒绝",
    apiKeyName: "密钥名称（1–64 个字符）",
    apiServerDesc: "为整个服务器开启或关闭 Agent API（仅管理员）",
    apiServerStateInvalid: (value) => `状态「${value}」无效：应为 on 或 off。`,
    apiStatusTitle: (agentRef) => `${agentRef} 的 Agent API`,
    apiFieldEnabled: () => "已开启",
    apiFieldOpen: () => "无密钥访问",
    apiFieldApproval: () => "审批模式",
    apiFieldBaseUrl: () => "Base URL",
    apiFieldAgentId: () => "Agent ID",
    apiFieldKeys: () => "密钥数",
    apiFieldServer: () => "服务器总开关",
    apiYes: () => "是",
    apiNo: () => "否",
    apiServerOn: () => "开",
    apiServerOff: () => "关（所有 API 请求均被拒绝）",
    apiColKeyId: () => "ID",
    apiColKeyName: () => "名称",
    apiColPrefix: () => "前缀",
    apiColCreated: () => "创建时间",
    apiColLastUsed: () => "最近使用",
    apiKeyNever: () => "从未",
    apiKeysEmpty: (agentRef) => `${agentRef} 还没有 API 密钥。`,
    apiKeyCreated: (name, prefix, agentRef) =>
      `已为 ${agentRef} 新建密钥「${name}」（${prefix}…）。密钥只在上方显示这一次，请立即保存。`,
    apiKeyDeleted: (keyId, agentRef) => `已删除 ${agentRef} 的密钥 ${keyId}。`,
    apiServerSet: (on) =>
      on
        ? "这台服务器的 Agent API 已开启。"
        : "这台服务器的 Agent API 已关闭：所有请求均被拒绝，各 Agent 的设置与密钥保留。",
    apiSignInRequired: () =>
      "请先登录：`penguin auth login`（或在服务器本机运行 `penguin auth token`）。本机 API token 不能改变 Agent 的对外暴露。",
    apiOpenWarning: () =>
      "警告：已开启无密钥访问。任何能访问此服务器地址的程序现在都无需密钥即可与该 Agent 对话，用的是本 Project 的模型与凭据。仅建议在只监听本机的服务器上保持开启；`--no-open` 可关闭。",
    exportDesc: "将 Agent 导出为其目录的 zip（vault 从不进包）",
    exportOut: "写入的文件（缺省为服务端给出的名称 <agent-id>-<yyyymmdd>.zip）",
    exportNoSkills: "不带技能",
    exportNoHooks: "不带钩子包",
    exportNoMemory: "不带记忆",
    exportNoWorkbenches: "不带 Workbench",
    exportNoWorkbenchData: "Workbench 只带源码，不带其数据（state.json）",
    exportSchedules: "带上定时任务（导入后会按计划运行）",
    exportTraces:
      "带哪些 Session：none、last:<N>（1~500，按最近活跃，Subagent 会话随其父）或 <yyyy-mm-dd>..<yyyy-mm-dd>",
    exported: (agentId, file) => `已将 Agent ${agentId} 导出到 ${file}。`,
    importDesc: "从 zip、tar.gz 快照包或 Agent 目录导入 Agent",
    importAgentId: "Agent id（缺省取 zip 的顶层目录名或目录名）",
    importOverwrite: "替换该 id 已有 Agent 的 State（仅 Project owner），先写一份备份快照",
    imported: (mode, agentId, projectId, version, sessions) =>
      `已在 Project ${projectId} ${mode === "created" ? "新建" : "覆盖"} Agent ${agentId}（版本 ${version}），导入 ${sessions} 个 Session。`,
    importBackup: (file) => `被替换的 State 已备份为 snapshots/${file}。`,
    importSkipped: (ids) => `跳过本安装已有的 ${ids.length} 个 Session：${ids.join("、")}`,
    importOverwriteHint: () =>
      "用 --agent-id <id> 改用其他 id 导入，或用 --overwrite 覆盖该 Agent（仅 Project owner）。",
    importUnreadable: (file) => `无法读取 ${file}。`,
    importTooLarge: (dir) =>
      `${dir} 超出导入上限（20 000 个文件、512MB、压缩后 64MB），未发送任何内容。`,
  },
};
