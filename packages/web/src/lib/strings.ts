/**
 * UI copy (bilingual): this file holds the Chinese dictionary `zh` and the runtime
 * active dictionary `S`; the English dictionary lives in strings-en.ts (constrained
 * to the same shape by the `Strings` type). Locale preference is resolved by
 * state/locale.tsx, which calls `setActiveStrings` to switch and remounts the whole
 * tree keyed by locale, so `S.x` reads in components always reflect the current
 * language (module-level constants do not update on switch — keep reads inside components).
 * Keep domain terms capitalized in English — Workspace, Token, Task, Session, Project, Trace.
 * "agent" is a common noun: lowercase mid-sentence, capitalized only at the start of a
 * label/sentence or in a proper name (Agent State, AgentHub). zh keeps "Agent" as-is.
 */
export const zh = {
  appName: "PenguinHarness",

  nav: {
    chat: "对话",
    newChat: "新对话",
    agents: "智能体",
    skills: "技能库",
    models: "模型库",
    usage: "成本中心",
    traces: "轨迹观测",
    benchmark: "评估中心",
    // Collapsed-rail tooltip (product-specified wording; new chat reuses chat.newSessionMenu, the other pages reuse the page names above).
    lastConversation: "最近一次对话",
    collapseSidebar: "收起侧栏",
    expandSidebar: "展开侧栏",
    collapseGroup: "折叠",
    expandGroup: "展开",
    pinGroup: "置顶分组",
    unpinGroup: "取消置顶",
  },

  settings: {
    language: "语言",
    /** Sidebar Session list: also show CLI-created Sessions (default off — the list then never scans the Trace directories). */
    showCliSessions: "显示 CLI 会话",
    theme: "主题",
    themeLight: "浅色",
    themeDark: "深色",
    followSystem: "跟随系统",
    langZh: "中文",
    langEn: "English",
    fontSize: "字号",
    fontSmall: "小",
    fontMedium: "中",
    fontLarge: "大",
    accent: "主题色",
    accentNames: {
      neutral: "灰白",
      blue: "蓝",
      green: "绿",
      violet: "紫",
      rose: "红",
      amber: "橙",
    } as Record<string, string>,
  },

  /** Version footer, update reminder, and admin self-update in the sidebar user menu. */
  update: {
    /** Version-line date label (owner-specified wording); `date` is formatMonthDay output, e.g. 「最近更新日期 7 月 26 日」. */
    lastUpdated: (date: string) => `最近更新日期 ${date}`,
    /** Superscript badge on the version lines when the update check found a newer release (owner-specified wording). */
    newVersionBadge: "有新版本可用",
    newVersion: (v: string) => `新版本 v${v} 可用`,
    /**
     * 用户菜单里**唯一**的更新行：未知新版本时显示「检查更新」并执行手动检查；已知新版本后改为
     * newVersion() 文案，点击打开更新弹窗（弹窗内含更新说明链接，管理员另有自更新操作）。
     */
    checkNow: "检查更新",
    checking: "检查中…",
    /** 手动检查发现新版本时的成功提示；下方同一行即变为更新入口。 */
    foundNew: (v: string) => `发现新版本 v${v}，点击下方更新入口即可安装`,
    upToDate: "已是最新版本",
    checkFailed: "检查更新失败，请稍后重试",
    checkDisabled: "更新检查已关闭（PENGUIN_UPDATE_CHECK=off）",
    releaseNotes: "更新说明",
    updateNow: "立即更新",
    updating: "更新中…",
    updated: "更新完成，重启服务后生效",
    restartHint: "在终端重新运行 penguin web（或 penguin server）即可完成重启",
    failed: "更新失败",
    unsupported: "当前安装方式不支持在线更新",
    confirmBody:
      "将下载最新版本并安装到服务器上的安装目录（数据目录不受影响）。安装完成后需要重启服务才会生效。",
    /** 非管理员看到的说明（可查看更新说明，但不能在此执行更新），替代 confirmBody。 */
    adminOnly: "只有管理员可以在这里执行更新。",
  },

  common: {
    save: "保存",
    cancel: "取消",
    create: "创建",
    delete: "删除",
    edit: "编辑",
    settings: "设置",
    confirm: "确认",
    close: "关闭",
    loading: "加载中…",
    saved: "已保存",
    saving: "保存中…",
    /** Clicking save with nothing changed: an info toast instead of a silent no-op. */
    noChangesToSave: "当前没有需要保存的修改",
    /** Confirm-before-save dialog shared by the settings forms (writes go to server-side config files). */
    confirmSaveTitle: "保存修改",
    confirmSaveBody: "确定保存这些修改吗？修改将写入服务器上的配置文件。",
    none: "（无）",
    retry: "重试",
    unknownError: "请求失败，请稍后重试",
    requiredField: "此项必填",
    copied: "已复制",
    name: "名称",
    username: "用户名",
    role: "角色",
    actions: "操作",
    created: "创建时间",
    cost: "成本",
    time: "时间",
  },

  auth: {
    usernameHint: "2~32 位：小写字母开头，仅小写字母、数字与下划线",
    password: "密码",
    passwordHint: "至少 8 个字符",
    showPassword: "显示密码",
    hidePassword: "隐藏密码",
    login: "登录",
    logout: "登出",
    admin: "管理员",
    defaultAdminNote:
      "首次使用请以内置管理员 admin 登录，初始密码在服务端首次启动时打印（形如 penguin-1234），登录后请尽快修改密码",
  },

  account: {
    changePassword: "修改密码",
    oldPassword: "当前密码",
    oldPasswordHint: "内置管理员的初始密码在服务端首次启动时打印（形如 penguin-1234）",
    newPassword: "新密码",
    confirmPassword: "确认新密码",
    passwordMismatch: "两次输入的新密码不一致",
    initialPasswordBanner: "当前账号正在使用初始密码，建议尽快修改",
    changeNow: "去修改",
  },

  admin: {
    users: "用户管理",
    roleAdmin: "管理员",
    roleUser: "用户",
    createUser: "新增用户",
    initialPassword: "初始密码",
    initialPasswordFlag: "初始密码",
    defaultProjectNote: (id: string): string => `将自动创建默认 Project：${id}`,
    resetPassword: "重置密码",
    resetPasswordTitle: (u: string): string => `重置 ${u} 的密码`,
    resetPasswordNote: "重置后该用户的登录会话全部失效，需用新密码重新登录",
    deleteUserTitle: (u: string): string => `删除用户 ${u}`,
    deleteUserConfirm: (u: string): string =>
      `将删除用户 ${u} 及其名下全部 Project（含数据目录），不可恢复。`,
  },

  project: {
    switcher: "Project",
    create: "新建 Project",
    createTitle: "新建 Project",
    id: "Project id",
    idHint: "2~64 位：小写字母开头，仅小写字母、数字与下划线；创建后不可修改",
    idPrefixHint: "id 固定以「用户名-」为前缀，后接小写字母、数字或下划线；创建后不可修改",
    name: "显示名（可选，缺省为 Project id）",
    /** Project 设置里的显示名字段（此处必填，与新建对话框的「可选」措辞区分）。 */
    displayName: "显示名",
    settings: "Project 设置",
    settingsTitle: "Project 设置",
    members: "成员",
    addMember: "添加成员",
    removeMember: "移除",
    /** 新对话默认值分节（Project 设置）：预填每个新建对话的 Agent / 工作目录 / 审批模式 / 思考等级 / 默认模型。 */
    chatDefaultsTitle: "新对话默认值",
    chatDefaultsHint: "新建对话时预填的默认值：Agent、工作目录、审批模式、思考等级与默认模型。",
    chatDefaultsAgent: "Agent",
    chatDefaultsNotSet: "未设置",
    chatDefaultsApprovalNotSet: "未设置（默认全部放行）",
    chatDefaultsThinkingNotSet: "未设置（跟随智能体配置）",
    chatDefaultsWorkspaceHint: "留空表示自动临时目录",
    /** 模型默认值与模型页同源（同一个 default_model），此处仅是另一处入口。 */
    chatDefaultsModelHint: "与模型页的默认模型同步",
    deleteProject: "删除 Project",
    deleteConfirm: "确认删除该 Project？项目目录将被递归删除，不可恢复。",
    deleteDefaultForbidden: "default_project 与 CLI 共用，不允许在 Web 端删除",
    deleteLastForbidden:
      "这是当前账号最后一个 Project，删除后将无 Project 可用；请先创建新的 Project",
    noCredentialTitle: "尚未配置模型 credential",
    noCredentialBody: "当前 Project 的默认模型尚未配置 API key，发起对话前请先前往模型页配置。",
    goToModels: "前往模型页",
    later: "稍后再说",
  },

  agent: {
    listTitle: "Agents",
    create: "创建 Agent",
    createTitle: "创建 Agent",
    id: "Agent id",
    idHint: "2~64 位：小写字母开头，仅小写字母、数字与下划线；创建后不可修改",
    nameHint: "留空则使用 Agent id 作为名称",
    description: "描述",
    activeSessions: "活跃 Session",
    sessionCount: (n: number): string => `${n} 个 Session`,
    toolCount: (n: number): string => `${n} 个工具`,
    vaultKeyCount: (n: number): string => `${n} 个密钥`,
    scheduleCount: (n: number): string => `${n} 个定时任务`,
    updatedAt: "最后修改",
    activity: (days: number): string => `近 ${days} 天 Session 活跃度`,
    settings: "Agent 设置",
    backToList: "返回 Agents",
    tabOverview: "概览",
    tabPrompt: "Prompt",
    tabRuntime: "运行参数",
    tabTools: "工具",
    tabSkills: "技能",
    tabVault: "密钥保险柜",
    tabSchedules: "定时任务",
    stateDir: "State 路径",
    agentsMd: "AGENTS.md",
    systemPrompt: "system_prompt 模板",
    placeholdersTitle: "可用占位符（点击插入）",
    insertPlaceholder: "插入到 system_prompt 光标处",
    /** Order must match the default system prompt (core default-config.ts DEFAULT_SYSTEM_PROMPT). */
    placeholders: [
      ["{{AGENTS_MD}}", "注入 AGENTS.md 内容"],
      ["{{VAULT_KEYS}}", "注入密钥保险柜的键名小节（无键时为空）"],
      ["{{SKILL_METADATA}}", "注入已安装 Skill 的元数据行（无 Skill 时为空）"],
      ["{{PLATFORM}}", "运行平台"],
      ["{{OS_VERSION}}", "操作系统版本"],
      ["{{DATE}}", "当前日期"],
      [
        "{{PROJECT_DIR}}",
        "PenguinHarness 应用数据根目录（存放全部 Agent 数据与 Project 级数据；不是本次任务的工作目录）",
      ],
      ["{{AGENT_ID}}", "当前 Agent id"],
      ["{{CWD}}", "Workspace 绝对路径"],
      ["{{PROVIDER}}", "模型 provider 分组"],
      ["{{MODEL_ID}}", "上游模型 id"],
      ["{{SESSION_ID}}", "当前 Session id"],
    ] as ReadonlyArray<readonly [string, string]>,
    maxTurns: "max_turns（单 Task 最大轮次，-1 不限制）",
    maxTokens: "model.max_tokens",
    thinkingLevel: "model.thinking_level",
    /** Selectable tiers exclude `none` (many models cannot disable thinking); a stored `none` still displays — see `thinkingLevelNoneKept`. */
    thinkingLevelOptions: [
      ["", "不提交覆盖值，沿用当前生效的配置。"],
      ["low", "开启较低强度的扩展推理。"],
      ["medium", "开启中等强度的扩展推理（新建 Agent 的缺省档位）。"],
      ["high", "开启较高强度的扩展推理，响应更慢。"],
      ["xhigh", "开启最高强度的扩展推理，部分模型上效果与 high 相同。"],
    ] as ReadonlyArray<readonly [string, string]>,
    /** Row description shown only while the stored config is `none`: displayed as-is, never rewritten, and no longer offered as a choice. */
    thinkingLevelNoneKept: "已存的历史档位：新选择不再提供关闭档（多数模型不支持关闭思考）。",
    timeoutMs: "model.timeoutMs",
    timeoutMsHint: "单次 Request 超时，毫秒",
    compaction: "上下文压缩（compaction）",
    maxContextLength: "max_context_length",
    maxContextLengthHint: "触发压缩的上下文阈值",
    maxSessionTurns: "max_session_turns",
    maxSessionTurnsHint: "触发压缩的轮数阈值",
    compactionMode: "mode（压缩方式）",
    compactionModeOptions: [
      ["", "不提交覆盖值，沿用当前生效的配置。"],
      ["summarize", "先让模型为旧上下文生成摘要，再从摘要续接新的上下文窗口（缺省）。"],
      ["discard", "不生成摘要，直接丢弃旧上下文，下一轮从新窗口重新开始。"],
    ] as ReadonlyArray<readonly [string, string]>,
    compactionPrompt: "prompt（摘要提示词）",
    maxTurnsInvalid: "max_turns 必须 > 0 或为 -1",
    timeoutInvalid: "timeoutMs 必须 > 0 或为 -1",
    toolFieldInvalid: (name: string, field: string) => `${name}: ${field} 必须是 > 0 的整数或 -1`,
    toolPermission: "permission",
    permissionReadLabel: "Read-only",
    permissionReadDescription: "仅读取。审批模式为 read-only 时自动放行，无需确认。",
    permissionReadWriteLabel: "Read & write",
    permissionReadWriteDescription: "可修改。审批模式为 read-only 时需人工确认。",
    toolTimeout: "timeoutMs",
    toolMaxOutput: "maxOutputLength",
    toolCallDescription: "call_description",
    callDescriptionHint:
      "call_description：开启（缺省）时该工具的 schema 保留可选的 description 参数——模型为每次调用写一句说明，运行期间展示给用户；关闭则装配时从 schema 滤除该参数。仅参数中定义了 description 属性的工具可切换。",
    mcpServers: "MCP Server（只读）",
    defaultValue: "（缺省）",
    /** Reset link next to the runtime dropdowns: rewinds the local pick back to "not overridden" (the menus offer no inherit row). */
    deleteAgent: "删除 Agent",
    builtinUndeletable: "内置 Agent 不可被删除",
    deleteConfirm: (name: string): string =>
      `确认删除 Agent「${name}」？其目录（含全部 Trace）将被递归删除，不可恢复。`,
    stateVersion: "Agent State 版本",
    transferTitle: "导出 / 导入",
    transferDesc: "导出当前 Agent State 快照包（tar.gz）；导入整目录覆盖，并以包内版本为准。",
    exportSnapshot: "导出快照",
    importSnapshot: "导入快照",
    importing: "导入中…",
    importDone: (v: number): string => `导入完成，Agent State 版本 v${v}`,
    importConflictTitle: "版本冲突",
    importConflictBody: "快照包版本不高于当前版本，导入将覆盖现有 Agent State。确认继续？",
    resetConfigTitle: "还原为默认配置",
    resetConfigDesc:
      "把 system_config.yaml 还原为当前内置默认值（与 Skill 更新同语义）：自定义的系统提示词、工具列表、模型/压缩参数与 MCP Server 将被覆盖，仅保留名称、描述与版本号。",
    resetConfigAction: "还原为默认配置",
    resetConfigConfirmBody:
      "此操作会用当前默认值覆盖该 Agent 的现有配置：自定义系统提示词、工具列表、模型/压缩参数与 MCP Server 全部被替换，仅保留名称与描述。与 Skill 更新一样不可撤销，确认继续？",
    resetConfigDone: "配置已还原为当前默认值",
  },

  models: {
    title: "模型配置",
    addCustom: "添加自定义模型",
    addToGroup: "新增模型",
    editTitle: "模型配置",
    addTitle: "新增模型（OpenAI 协议）",
    addTitleVendor: "新增模型",
    addProtocolHint:
      "新增模型固定走 OpenAI Chat Completions 兼容协议（不按模型 id 自动路由），base URL 填其兼容端点",
    addAutoRouteHint:
      "该分组的新模型按上游 id 由 AgentHub 自动路由到厂商官方客户端：base URL 留空即官方端点，API key 留空按解析出的客户端读取环境变量",
    /** Caution beside the base URL when the entry uses a vendor's official protocol (everything except the OpenAI-protocol path). */
    baseUrlOfficialNote:
      "注意：该模型走厂商官方协议——自定义 base URL 必须是兼容官方协议的端点，不会因此切换为 OpenAI 协议",
    autoRouteNone:
      "该 id 无法被 AgentHub 自动路由：请核对 id，或改在 Custom / 自建分组下以 OpenAI 协议接入",
    addGroup: "新增分组",
    addGroupTitle: "新增分组",
    addGroupDesc:
      "自建分组与 Custom 同语义：组内模型走 OpenAI Chat Completions 兼容协议（base URL 必填，API key 留空读取 OPENAI_API_KEY）。分组由模型条目承载，保存首个模型后即出现。",
    groupNameLabel: "分组名",
    groupNameHint: "小写字母 / 数字开头，可含 - 与 _",
    groupNameInvalid: "分组名只能用小写字母、数字、- 与 _（首字符为字母或数字），长度不超过 32",
    groupNameExists: "该分组名已被内置分组或既有条目占用",
    groupEmptyHint: "该分组暂无模型，点「新增模型」添加",
    searchPlaceholder: "搜索模型：id / 名称 / 厂商",
    noSearchResults: "没有匹配的模型",
    syncCatalog: "同步预置",
    syncCatalogHint:
      "用内置目录更新预置模型：新增缺失条目、以目录字段为准刷新差异；本地新增模型与 API key 保持不变",
    syncDone: (added: number, updated: number) => `预置模型已同步：新增 ${added}、更新 ${updated}`,
    syncUpToDate: "预置模型已是最新",
    homepage: "模型主页",
    speedTest: "测速",
    speedTestTitle: "分组测速",
    speedTestConfirm: (n: number): string =>
      `将对该分组的 ${n} 个模型逐个发起一次真实请求,测量首 token 延迟(TTFT)与输出速率(TPS),会消耗少量 API 额度。是否继续?`,
    speedTestStart: "开始测速",
    speedPending: "测速中…",
    speedFailed: "测速失败",
    ttftTitle: "首 token 延迟(TTFT)",
    tpsTitle: "输出速率(TPS)",
    modelCount: (n: number): string => `${n} 个模型`,
    modelId: "模型 ID",
    modelIdHint: "上游 API 使用的模型 id，如 gpt-5.5",
    displayName: "模型名称",
    displayNameHint: "留空则展示模型 ID",
    providerGroup: "分组",
    contextWindow: "上下文窗口",
    /** 单位后缀，显示在上下文窗口/最大输出长度输入框内右侧。 */
    tokenUnit: "Token",
    contextWindowHint: "留空表示未知",
    maxTokens: "最大输出长度",
    /** Placeholders cannot scroll, so this must fit the half-width box; the full guidance is the input's title tooltip (the owner prefers no visible hint line — saves vertical space). */
    maxTokensHint: "留空沿用 Agent 设置",
    maxTokensTitle:
      "按模型限制单次请求的最大输出 Token 数；留空沿用 Agent 设置，小上下文模型建议调低",
    maxTokensInvalid: "必须为正整数",
    clientTypeLocked: (t: string): string => `协议：${t}（沿用原配置，不可修改）`,
    /** Switch label only — the dialog carries no explanation text for it (per owner). */
    vision: "支持视觉",
    /** Shown only while the vision switch is OFF: images are then read via the configured vision proxy model (describe_image). */
    visionOffProxyHint: "使用视觉代理模型读图",
    visionBadge: "视觉",
    /** Light-yellow badge on zero-cost models (all three price buckets 0, e.g. the :free variants and openrouter/free). */
    freeBadge: "免费",
    visionModelBadge: "视觉代理",
    setVisionModel: "设为视觉代理模型",
    visionModelHint: "供不支持图片的模型经 describe_image 代读图片",
    priceUnitShort: "/M tok",
    testConnection: "测试连通性",
    testing: "测试中…",
    testOk: (ms: number): string => `连通正常（${ms} ms）`,
    testFailed: (msg: string): string => `连通失败：${msg}`,
    priceCacheRead: "缓存读取价格",
    priceCacheWrite: "缓存写入价格",
    priceOutput: "输出价格",
    currency: "币种",
    currencyUsd: "美元 $",
    currencyCny: "人民币 ¥",
    apiKey: "API key",
    apiKeyKeepHint: "留空保留现有 key",
    apiKeyEnvHint: (envKey: string): string => `留空则使用环境变量 ${envKey}`,
    keyConfigured: "已配置 key",
    clearApiKey: "清除已存 API key",
    baseUrl: "自定义 base URL",
    baseUrlHint: "留空使用厂商默认地址",
    baseUrlRequired: "必须填写 base URL",
    contextWindowDefaultHint: (n: number): string => `留空按 ${n} 计`,
    confirmDeleteTitle: "删除模型",
    confirmDelete: (name: string): string =>
      `确定删除「${name}」？该模型的配置与 API key 将一并移除。`,
    groupApiKey: "统一配置 API key",
    groupApiKeyTitle: (label: string): string => `为「${label}」统一配置 API key`,
    groupApiKeyHint: (n: number): string => `将写入该分组下全部 ${n} 个模型；留空不改动。`,
    getApiKey: "获取 API key",
    getModelIds: "获取模型 id",
    groupKeyApplied: (n: number): string => `已为 ${n} 个模型配置 API key`,
    // Providers with separate domestic / international endpoints: note on the default
    // endpoint used when left blank via env var (the other side's key needs an explicit
    // base URL). Written to match AgentHub's actual behavior; rendered wherever the env fallback hint appears.
    providerEnvNotes: {
      zhipu:
        "缺省端点为 Z.AI 国际版（api.z.ai）；智谱开放平台（bigmodel.cn）的 key 需填 base URL https://open.bigmodel.cn/api/paas/v4",
      moonshot:
        "缺省端点为国内版（api.moonshot.cn）；platform.kimi.com（国际）的 key 需填 base URL https://api.moonshot.ai/v1",
    } as Record<string, string | undefined>,
    confirmVisionModelTitle: "设为视觉代理模型",
    confirmVisionModel: (name: string): string =>
      `确定把「${name}」设为视觉代理模型？不支持图片的模型将由它经 describe_image 代读图片。`,
    confirmSaveTitle: "保存模型配置",
    confirmSave: (name: string): string => `确定保存对「${name}」的配置修改？`,
    confirmDefaultTitle: "设为默认模型",
    confirmDefault: (name: string): string =>
      `确定把「${name}」设为默认模型？新建的 Session 将默认使用它。`,
    default: "默认",
    setDefault: "设为默认模型",
    remove: "删除模型",
    readOnlyHint: "member 只读；模型与 credential 修改仅 owner 可执行",
    empty: "尚未配置任何模型",
    noKey: "未配置 key",
    /** Chat model dropdown's bottom expander row: reveals the models hidden by the configured-key filter. */
    showModelsWithoutKey: (n: number): string => `显示未配置 key 的模型（${n} 个）`,
    modelIdExists: "该模型 id 已存在",
    pricingAllOrNone: "三项价格需一并填写",
    pricingInvalid: "必须为数字",
    contextWindowInvalid: "必须为数字",
  },

  vault: {
    desc: "本 Agent 专属的环境变量（存于 agent_state/.vault.toml）：键值对注入其 shell 命令（exec_command）的子进程环境；键名会告知模型，值不进入模型上下文。子 Agent 使用各自的保险柜，不继承。保存后自下一个任务起生效（进行中的任务不受影响）。",
    key: "键名",
    value: "值",
    valueMasked: "值（掩码）",
    add: "添加",
    addTitle: "添加环境变量",
    remove: "删除",
    deleteTitle: "删除环境变量",
    deleteConfirm: (key: string): string => `确认删除环境变量「${key}」？值不可恢复。`,
    overwriteTitle: "覆盖已有环境变量",
    overwriteConfirm: (key: string): string => `「${key}」已存在，保存将覆盖原值且不可恢复。`,
    empty: "尚未配置任何环境变量",
    readOnlyHint: "member 只读；Vault 修改仅 owner 可执行",
    keyHint: "字母、数字与下划线，不能以数字开头",
    keyInvalid: "键名不合法：仅字母、数字与下划线，且不能以数字开头",
    valueRequired: "值不能为空",
  },

  schedule: {
    desc: "定时任务（agent_state/schedule/*.toml）：到点自动向目标 Session 发送 prompt；文件亦可手工编辑，Web 端修改后即时生效。",
    readOnlyHint: "member 只读；定时任务修改仅 owner 可执行",
    colStatus: "状态",
    colPeriod: "周期",
    colTarget: "目标",
    colFireTimes: "下次 / 最近触发",
    colQueued: "排队",
    statusNames: {
      active: "生效",
      disabled: "停用",
      expired: "已过期",
      done: "已完成",
      missed: "已错过",
      invalid: "无效",
    } as Record<string, string>,
    queued: "排队中",
    once: "一次性",
    newSession: "新建会话",
    invalidFiles: "解析失败的文件（已跳过调度）",
    empty: "尚未配置定时任务",
    enable: "启用",
    disable: "停用",
    addTitle: "新建定时任务",
    editTitle: (name: string): string => `编辑定时任务「${name}」`,
    nameHint: "即文件名（不含 .toml），创建后不可改",
    prompt: "Prompt",
    enabled: "启用",
    startAt: "开始时间",
    endAt: "结束时间（可选）",
    period: "周期",
    periodPlaceholder: "30m / 12h / 7d，留空为一次性",
    target: "目标",
    targetNew: "每次新建会话",
    targetSession: "绑定 Session",
    sessionId: "Session id",
    workspace: "Workspace（可选，留空自动创建）",
    model: "Model",
    modelDefault: "Project 默认",
    deleteTitle: "删除定时任务",
    deleteConfirm: (name: string): string => `确认删除定时任务「${name}」？`,
  },

  skills: {
    pageTitle: "技能库",
    pageDesc: "内置 Skill 库：浏览、快捷调用，或安装到 Agent。",
    quickInvoke: "快捷调用",
    /** Pre-filled body for quick invoke (per UI language; English is `use the <name> skill`). */
    quickInvokeText: (name: string): string => `使用 ${name} 技能`,
    manageInstall: "管理安装",
    manageInstallTitle: (name: string): string => `管理安装：${name}`,
    install: "安装",
    installed: "已安装",
    uninstall: "卸载",
    /** Skill count in the group header (small text to the right of the group name). */
    skillCount: (n: number): string => `${n} 个技能`,
    /** Usage count in the card metadata (shows "unused" instead of a bare 0). */
    usedByAgents: (n: number): string => (n === 0 ? "未被使用" : `${n} 个 Agent 在用`),
    /** Top toast shown on successful install / uninstall. */
    installedToast: (skill: string, agent: string): string => `已将 ${skill} 安装到 ${agent}`,
    updateOutdated: (n: number): string => `有新版本：更新 ${n} 个 Agent 的安装`,
    updateAction: "更新",
    updateConfirmTitle: (name: string): string => `更新 ${name}`,
    updateConfirmWarning: (name: string): string =>
      `更新 ${name} 会把库内当前副本重装到各 Agent，覆盖其已安装的文件——对已装技能的本地改动会丢失，如有需要请先导出备份。`,
    updatedToast: (skill: string, n: number): string =>
      `已将 ${skill} 更新到最新版（${n} 个 Agent）`,
    uninstalledToast: (skill: string, agent: string): string => `已从 ${agent} 卸载 ${skill}`,
    /** Uninstall confirmation: removing the installed copy deletes its files (local edits included). */
    uninstallConfirmTitle: (name: string): string => `卸载 ${name}`,
    uninstallConfirmBody: (skill: string, agent: string): string =>
      `确定从 ${agent} 卸载 ${skill} 吗？已安装的技能文件（含本地改动）将被删除。`,
    /** Agent settings "Skills" tab (installed list + import modal). */
    agentTabDesc:
      "该 Agent 已安装的技能（agent_state/skills/，文件即事实来源）：元数据注入系统提示词，正文由模型按需读取；卸载会删除整个技能目录。",
    agentTabEmpty: "尚未安装任何技能",
    exportSkill: "打包导出",
    importSkill: "导入技能",
    importChatTitle: "推荐：让 Agent 在对话中安装",
    importChatWhy: "Agent 能完整阅读、审查并按需调整技能内容，比直接上传更可靠。",
    importSourceLabel: "技能来源",
    importSourceHint: "支持网页 / GitHub 仓库或目录 / 本地路径 / 其他生态的安装命令",
    importSourcePlaceholder: "https://…、git 仓库、/path/to/skill 或 npx skills add <name>",
    /** Preview placeholder shown in the generated prompt before a source is entered. */
    importSourceToken: "<来源>",
    importPromptLabel: "发送给 Agent 的 Prompt（预览）",
    /** Per-source lead sentence of the generated install prompt; composed with importPromptTail by buildImportPrompt (features/agents/skill-import-source.ts). */
    importPromptLead: {
      webUrl: (s: string): string => `请阅读这个网页，并把其中的 Skill 安装到你的技能目录：${s}。`,
      repoUrl: (s: string): string =>
        `请获取这个仓库或目录（git clone 或直接抓取），定位其中含 SKILL.md 的技能目录，并安装到你的技能目录：${s}。`,
      localPath: (s: string): string =>
        `请直接读取这个本地路径下的技能文件，并安装到你的技能目录：${s}。`,
      command: (s: string): string =>
        `这是一条其他生态的技能/插件安装命令，请不要直接执行：先解读它会安装什么，从对应的仓库或注册表获取相同内容，再安装到你的技能目录：${s}。`,
      reference: (s: string): string =>
        `请根据这个技能/插件引用找到其来源（仓库、插件市场或文档页），并把对应的 Skill 安装到你的技能目录：${s}。`,
    },
    /** Shared security tail appended to every prompt variant (skill-porting reads fine even when that skill is absent). */
    importPromptTail:
      "安装前请完整阅读全部内容，确认安全、无恶意指令后再写入，并向我说明它的用途。如果你安装了 skill-porting 技能，请先阅读并按其流程处理。",
    importCopyPrompt: "复制 Prompt",
    importCopied: "已复制到剪贴板",
    importOpenChat: "打开新对话",
    importUploadTitle: "上传技能 zip 包",
    importUploadDesc: "zip 根目录为 SKILL.md，或仅含一个内含 SKILL.md 的顶层目录。",
    importUploadAction: "选择 zip 文件",
    importUploading: "上传中…",
    importDoneToast: "技能已安装",
    importOverwriteTitle: "覆盖已安装技能",
    importOverwriteBody: (name: string): string =>
      `技能「${name}」已存在，覆盖安装将替换其全部文件（含本地改动），不可恢复。确认继续？`,
    importOverwriteAction: "覆盖安装",
  },

  chat: {
    newSessionMenu: "新建对话",
    chooseAgent: "选择 Agent",
    chooseModel: "选择模型",
    thinkingLevel: "思考等级",
    /** Short tier names for the pre-conversation picker (per review: short names only, no descriptions, no "default" row). `none` exists purely to display a stored legacy value — it is never offered as a choice (many models cannot disable thinking). */
    thinkingLevelNames: {
      none: "无",
      low: "低",
      medium: "中",
      high: "高",
      xhigh: "极高",
    } as Readonly<Record<string, string>>,
    workspaceUseThis: "使用此目录",
    workspaceUp: "上级目录",
    workspaceNoSubdirs: "无子目录",
    workspaceAuto: "自动临时目录",
    workspaceClear: "改用自动临时目录",
    workspaceDirInvalid: "目录不存在或无法访问，已回退",
    /** 侧栏对话列表的分组切换（默认按工作区）与工作区分组。 */
    groupByWorkspace: "按工作区分组",
    groupByAgent: "按 Agent 分组",
    tempWorkspaces: "临时工作区",
    newSessionInWorkspace: "在此工作区新建对话",
    draftSubtitle: "最擅长 AI 开发任务的自进化 Agent",
    /** 首页示例的折叠分组名（书签式，同时只展开一个）。 */
    exampleFolders: {
      webapps: "搭建网页应用",
      agents: "搭建和优化智能体",
    },
    /**
     * Example task cards on the draft screen: one click auto-submits the canned prompt. These
     * are the FULL working prompts — descriptions stay short, but the submitted instructions
     * remain detailed because execution quality depends on them.
     */
    exampleTasks: {
      game: {
        label: "2D 企鹅雪橇越野小游戏",
        desc: "可爱南极企鹅滑雪橇跳石头，难度由易到难的 2D 纯前端小游戏",
        prompt:
          "做一个可爱的南极企鹅滑雪橇越野 2D 小游戏：按空格键起跳，跃过冰面上迎面而来的石头；" +
          "开局要足够简单、上手无压力，滑行速度与障碍密度随时间平滑、循序渐进地上升，避免突然变难，" +
          "实时计分，撞上石头即结束并可一键重新开始。" +
          "2D 横版画面、可爱卡通风，纯前端实现（单个 HTML 文件即可），界面遵循 web-design 技能。" +
          "完成后在浏览器里自测一次，确认开局能轻松玩过几秒，并告诉我怎么打开和怎么玩。",
      },
      gamecenter: {
        label: "多智能体搭建小游戏中心",
        desc: "并行产出 10 个玩法互不重复的纯前端小游戏，配一个统一风格的索引首页",
        prompt: `用多智能体并行搭建一个网页小游戏中心：10 个玩法互不重复的纯前端小游戏，外加一个索引首页。

## 分工方式
- 先规划这 10 个游戏（例如贪吃蛇、2048、俄罗斯方块、打砖块、扫雷、记忆翻牌、推箱子、太空射击、跳跃平台、节奏点击），确认玩法确实互不重复，并定好统一的目录结构、配色与交互规范。
- 再把 10 个游戏分派给多个子智能体并行实现，每个子智能体只负责自己的那一个游戏，严格按既定规范产出，互不改动他人的文件。

## 每个游戏
- 独立的 \`games/<slug>/index.html\`，纯前端单文件、file:// 直接打开即可运行，不依赖后端与任何 CDN 资源。
- 具备开始 / 重新开始、实时计分或计时、失败或通关结算，并同时支持键盘与触摸操作，页面内写明玩法说明。
- 提供返回索引首页的入口。

## 索引首页
- 根目录 \`index.html\`：卡片网格列出全部 10 个游戏（名称 + 一句话玩法 + 操作方式），点击进入对应游戏。
- 与所有游戏共用一套设计语言，遵循 web-design 技能。

## 收尾
- 统一验收：10 个游戏玩法确实不重复、风格一致，索引页的链接全部可达。
- 在浏览器里逐个自测，确认都能开始、能结束、能重开，然后告诉我怎么打开。`,
      },
      lol: {
        label: "英雄联盟音乐播放器",
        desc: "用 SoundCloud Widget API 播放历届 Worlds 主题曲，单文件即开即用",
        prompt: `用 SoundCloud Widget API（见 https://developers.soundcloud.com/docs/api/html5-widget）做一个英雄联盟 Worlds 主题曲播放器，单文件 index.html，file:// 打开即用。

## 技术约束
- 使用 SC.Widget JS API（widget.load / widget.toggle / widget.setVolume / widget.seekTo），引入 https://w.soundcloud.com/player/api.js
- iframe 必须可见（180px 高），visual=true color=f0b90b single_active=true
- 仅包含以下 8 首已确认可播曲目（oEmbed 验证通过），不要添加未经 oEmbed 验证的曲目：
  - Warriors (S4) — soundcloud.com/leagueoflegends/warriors
  - Worlds Collide (S5) — soundcloud.com/leagueoflegends/worlds-collide
  - Legends Never Die (S7) — soundcloud.com/leagueoflegends/legends-never-die
  - Phoenix (S9) — soundcloud.com/leagueoflegends/phoenix
  - Burn It All Down (S11) — soundcloud.com/leagueoflegends/burn-it-all-down
  - GODS (S13) — soundcloud.com/leagueoflegends/gods
  - Heavy Is The Crown (S14) — soundcloud.com/linkinpark/heavy-is-the-crown
  - Sacrifice (S15) — soundcloud.com/leagueoflegends/sacrifice

## 布局
- 左侧 260px 粘性侧边栏：曲目列表（S4/S5/… 标签 + emoji + 曲名 + 年份），点击高亮金色边框，SC.Widget.load() 切歌 + auto_play
- 右侧主区域：Hero 标题 + 桌面时钟（80px 等宽金色 HH:MM:SS，每秒刷新，冒号闪烁）+ 心情标签
- 播放器卡片：SoundCloud iframe + 自定义控制栏（⏮ ▶/⏸ ⏭ + 曲目信息 + 音量滑块，点击喇叭图标静音切换）
- 心情波动区：15 根金色动画柱，切歌时重新随机生成
- 键盘快捷键：空格播放暂停、← → 切歌、↑ ↓ 调音量

## 设计
Penguin 视觉风格（见 web-design 技能），默认深色。手机端侧边栏变为顶部横向滚动。

完成后在浏览器打开 index.html 自测一次。`,
      },
      rag: {
        label: "构建 Claude Code 文档 RAG 智能体",
        desc: "收集 claude-code-docs 仓库，生成可对话、带来源引用的 RAG 知识应用",
        prompt:
          "收集 https://github.com/ericbuess/claude-code-docs 的文档，构建一个 RAG 知识应用：" +
          "克隆仓库并整理语料，建立检索索引；应用化身 Claude Code 配置专家，" +
          "检索增强回答 Claude Code 相关问题并标注可点击的来源引用——" +
          "引用要能展示命中的原文片段，并链接到真实文档；" +
          "按 web-design 技能提供美观的 Web 聊天界面。" +
          "完成后运行应用，用一个中文问题和一个英文问题各自测一次，" +
          "确认两者都检索到了正确的英文文档、流式回答正常，并告诉我访问方式。",
      },
      agentBenchmarkBuild: {
        label: "构建通用决策智能体和评测基准",
        desc: "创建一个通用决策 Agent，并用足球、售后和投资任务检验它",
        prompt: `请依次使用 \`agent-creation\` 和 \`benchmark-design\`，创建决策 Agent，并产出 Frozen Benchmark 与 Formal Baseline。

Agent：
- id：\`finite_choice_agent\`
- 能力：面对有限选项，在公开信息不足或冲突时仍能给出稳定、可解释的选择
- installed_skills：\`[]\`

Benchmark：
- id：\`contextual-choice-adaptation\`
- capability：从公开规则、历史案例和当前事实中形成并迁移稳定的有限选择决策过程
- desired_baseline_score：\`<75\`
- pilot_iteration_limit：\`5\`

场景：
1. 根据历史比赛与当前信息进行足球投注决策。
2. 根据售后政策与工单事实选择处置动作。
3. 根据投资策略、历史市场与当前指标选择投资动作。`,
      },
      agentOptimization: {
        label: "优化通用决策智能体的准确率",
        desc: "根据已有评测结果改进 Agent，并验证新版本是否真正提升",
        prompt: `请使用 \`agent-optimization\`，根据 Frozen Benchmark 优化决策 Agent。

- test_agent_id：\`finite_choice_agent\`
- benchmark_id：\`contextual-choice-adaptation\`
- capability_direction：提高信息不完整、规则冲突和有限选项决策中的稳定性
- runs：\`3\`
- desired_score：\`>=95\`
- candidate_round_limit：\`5\``,
      },
    },
    sessionList: "Session",
    defaultSessionTitle: "新对话",
    model: "Model",
    workspace: "Workspace",
    workspaceHint: "留空自动创建临时目录；指定时必须是服务器上已存在的目录",
    approvalMode: "审批模式",
    /** Short description (the trigger button shows only the description, not the mode id). */
    approvalModeNames: {
      "allow-all": "全部放行",
      "deny-all": "全部拒绝",
      "read-only": "放行只读",
      "always-ask": "总是询问",
    } as Record<string, string>,
    approvalModes: {
      "allow-all": "全部放行（allow-all）",
      "deny-all": "全部拒绝（deny-all）",
      "read-only": "放行只读（read-only）",
      "always-ask": "总是询问（always-ask）",
    } as Record<string, string>,
    statusRunning: "运行中",
    statusCompacting: "压缩中",
    pendingApprovals: (n: number) => `${n} 个待审批`,
    jumpToLatest: "回到最新消息",
    /** Conversation minimap (tick rail over the stream's left gutter): rail aria-label. */
    outlineTitle: "对话索引",
    /** Tick accessible name: turn number + the question (or the no-text placeholder). */
    outlineTickLabel: (n: number, question: string) => `第 ${n} 轮：${question}`,
    /** Entry label when the prompt had no text body (image / attachment-only message). */
    outlineNoText: "（图片或附件）",
    /** Answer-preview placeholder while the latest turn is still running with no reply text yet. */
    outlineAnswering: "回答生成中…",
    inputPlaceholder: "输入消息，Enter 发送，Shift+Enter 换行，可粘贴图片",
    inputPlaceholderShort: "输入消息…",
    /** Placeholder while a Task is running (mid-run steering): the message is delivered between turns with the next request. */
    steerPlaceholder: "给运行中的 Agent 留言，随下一轮对话送达",
    steerPlaceholderShort: "给运行中的 Agent 留言…",
    steerSend: "发送给运行中的 Agent",
    /** Queued hint shown after a successful steer, until the steering message appears in the stream. */
    steerQueuedIndicator: "插话已排队，将随下一轮送达",
    /** Same hint, with the queued message's content (from the server's undelivered-steering mirror; survives reloads). */
    steerQueuedItem: (content: string) => `插话已排队，将随下一轮送达：${content}`,
    /** Label of the [user_steering] chip (a mid-run user message delivered between turns). */
    userSteering: "用户插话",
    /** Mid-run send-mode setting: steer (delivered mid-run) vs follow-up (queued until the run ends). */
    steerModeLabel: "运行中发送方式",
    steerModeSteer: "插话",
    steerModeSteerHint: "立即插话：随下一轮对话送达运行中的 Agent",
    steerModeFollowUp: "排队",
    steerModeFollowUpHint: "排队跟进：本轮结束后自动作为新消息发送",
    followUpPlaceholder: "排队为下一条消息，本轮结束后自动发送",
    followUpPlaceholderShort: "排队为下一条消息…",
    followUpSend: "排队为下一条消息",
    /** Server-side queued follow-up count (auto-sent once the current run finishes). */
    followUpQueuedChip: (n: number) => `${n} 条跟进消息已排队，本轮结束后自动发送`,
    send: "发送",
    stop: "停止",
    compact: "压缩上下文",
    approve: "允许",
    deny: "拒绝",
    decisionAllow: "已批准",
    decisionDeny: "已拒绝",
    decisionManual: "手动",
    decisionAuto: "自动",
    thinking: "思考",
    subagent: "子会话",
    subagentRunning: "运行中",
    aborted: (reason?: string) => `[已中断]${reason ? `：${reason}` : ""}`,
    /** Auth-dead notice (request_end status "auth"): action-only copy — updating the key on the Models page auto-unlocks this Session. */
    modelAuthDead: "模型 API 认证失败：请在模型配置页更新该模型的 API key，或新建会话。",
    modelAuthDeadOpenModels: "打开模型配置",
    modelAuthDeadRetry: "重试",
    modelAuthDeadCta: "新建会话",
    modelAuthDeadPlaceholder: "模型认证失败，请先更新 API key",
    /**
     * Reconnect hint line; `secondsLeft` (waiting state only) switches to the live-countdown
     * wording. `failed` is in the union because the engine retries it like the other two —
     * its cause names the provider rather than the transport, since that is where it came from.
     */
    reconnect: (
      status: "failed" | "timeout" | "malformed",
      state: "waiting" | "retried" | "gaveUp",
      attempt: number,
      secondsLeft?: number,
    ) => {
      const cause =
        status === "timeout"
          ? "连接超时或网络中断"
          : status === "malformed"
            ? "响应不完整或无法解析"
            : "模型服务返回错误";
      const action =
        state === "gaveUp"
          ? "已停止重试"
          : state === "retried"
            ? `已发起第 ${attempt} 次重试`
            : secondsLeft !== undefined
              ? `第 ${attempt} 次重试，${secondsLeft} 秒后发起…`
              : `正在发起第 ${attempt} 次重试…`;
      return `[重试] ${cause}，${action}`;
    },
    /** "Retry now" on the reconnect countdown (skips the remaining backoff wait). */
    reconnectRetryNow: "立即重试",
    /** "Give up" on the reconnect countdown (the ordinary session abort). */
    reconnectGiveUp: "放弃",
    imageAlt: "用户上传的图片",
    toolImageAlt: "工具输出的图片",
    imagesAsPathHint:
      "当前模型不支持直接查看图片：发送时图片将保存到会话临时目录，以文件路径转交（模型经 describe_image 查看）",
    infoPanel: "Session 信息",
    sessionStats: "统计",
    /** Info-dropdown jump to the Trace page, deep-linked to the current Session. */
    viewTrace: "查看轨迹",
    statTokens: "Token 累计",
    statElapsed: "用时",
    statInput: "输入 tokens",
    statCached: "已缓存",
    statOutput: "输出 tokens",
    statTps: "输出 TPS",
    /** Copied-stats-line parenthesis wrappers around the cached amount (fullwidth for zh typography). */
    statParenOpen: "（",
    statParenClose: "）",
    noSessions: "还没有 Session",
    emptyStream: "发送一条消息开始对话",
    historyLoadFailed: "历史消息加载失败",
    statsLabel: "统计信息",
    removeImage: "移除图片",
    openWorkspace: "打开工作区",
    openAgents: "智能体面板",
    /** File summary card at the end of a message (Codex-style): title, inline preview action, and collapsed row. */
    filesInMessage: (n: number) => `${n} 个文件`,
    imagesInMessage: (n: number) => `${n} 张图片`,
    openPreview: "点击预览",
    showMoreFiles: (n: number) => `显示其余 ${n} 个文件`,
    showLess: "收起",
    /** Reveal the next page of sidebar groups (#139); n = groups still hidden. */
    moreGroups: (n: number) => `更多分组（${n}）`,
    contextUsage: "上下文占用",
    contextUnknown: "上下文占用：压缩后待下次请求回报",
    slashHint: "输入 / 使用命令",
    /** `/agent` handoff: command description, picker title, search box, no-match hint, and the staged target's description and remove button. */
    switchAgent: "交给其他 Agent，发送时开启新会话",
    switchAgentTitle: "选择 Agent",
    agentSearchPlaceholder: "搜索 Agent：id / 名称",
    agentsNoMatch: "没有匹配的 Agent",
    handoffTargetTitle: (agent: string) => `发送后交接给 ${agent}`,
    handoffRemove: "移除交接目标",
    /** Skill multi-select dropdown (input toolbar): button text, search box, empty state, and no-match hint. */
    skillsSelect: "技能",
    skillRemove: "移除技能",
    skillsSearchPlaceholder: "搜索技能",
    skillsNoMatch: "没有匹配的技能",
    skillsEmptyHint: "暂无已装技能，去技能库添加",
    /** Auto-generated invocation text when skills are selected and the body is empty (wrapped in [use_skills] before sending). */
    skillsAutoMessage: (names: string[]): string => `使用 ${names.join("、")} 技能`,
    handoffFrom: (agent: string) => `由 ${agent} 的对话交接而来`,
    handoffBack: (title?: string) => (title ? `回到原对话：${title}` : "回到原对话"),
    /** `/model` switch: command description, picker title, the staged target's description and remove button, the switch-origin banner, and the empty-body auto message. */
    switchModel: "切换模型，发送时开启新会话延续本对话",
    switchModelTitle: "切换模型",
    modelSwitchTargetTitle: (model: string) => `发送后换用 ${model} 延续本对话`,
    modelSwitchRemove: "移除切换模型",
    /** Why Send is disabled with a model switch staged: the fork branches off a Trace this Session is still writing. */
    modelSwitchBusyHint: "本轮结束后才能切换模型：新会话要从当前会话的记录接续",
    modelSwitchFrom: (prevModel?: string) =>
      prevModel ? `已切换模型（原为 ${prevModel}），延续原会话` : "已切换模型，延续原会话",
    /** First message body auto-sent when `/model` is staged and the composer is empty (same convention as skillsAutoMessage). */
    modelSwitchAutoMessage: "换用新模型继续这段对话",
    scheduledFrom: (name: string) => `由定时任务「${name}」触发`,
    emptyGreeting: "开始一段新对话",
    compactionRunning: (mode: string) => `压缩进行中（${mode}）…`,
    compactionDone: (mode: string): string =>
      mode === "discard" ? "[压缩] 完成，旧上下文已丢弃" : "[压缩] 完成，已切换到摘要后的新上下文",
    compactionFailed: (status: string, errorMessage?: string): string => {
      if (status === "aborted") return "[压缩] 已中断，保留当前上下文";
      return errorMessage !== undefined
        ? `[压缩] 失败（${errorMessage}），保留当前上下文`
        : "[压缩] 失败，保留当前上下文";
    },
    unknownTool: "（未知工具）",
    workRunning: "运行中",
    workDone: "运行完毕",
    workGroupSteps: (n: number) => `${n} 步`,
    approvalWaiting: "待审批",
    copyCode: "复制代码",
    copyReply: "复制回复",
    copyMessage: "复制消息",
    deleteSession: "删除对话",
    renameSession: "重命名对话",
    renameSessionLabel: "标题",
    deleteSessionConfirm: (title: string) =>
      `确定删除「${title}」？该对话的消息与 Trace 将被移除，且不可恢复。`,
    archiveSession: "归档",
    unarchiveSession: "取消归档",
    /** Sidebar group "reveal/load next page" row (display cap + server paging). */
    loadMore: "更多",
    /** Collapsed sidebar folders inside a group (lazy-loaded); the count is the group's exact server share. */
    folderGroups: {
      subagent: (n: number) => `子智能体（${n}）`,
      schedule: (n: number) => `定时任务（${n}）`,
      archived: (n: number) => `已归档（${n}）`,
    },
    skillsBanner: (names: string[]): string => `使用技能：${names.join("、")}`,
    /** Attached-file notice above a user message (file names only; the paths stay in the Trace). */
    attachedFilesBanner: (names: string[]): string => `附加文件：${names.join("、")}`,
    /** Composer "+" extension menu (image upload, file attachment, goal mode) and the goal chip. */
    plusMenu: "更多输入方式",
    uploadImage: "上传图片",
    uploadImageDesc: "为本条消息附加图片",
    uploadFile: "上传文件",
    uploadFileDesc: "文件存入会话临时目录，模型按路径读取",
    removeFile: "移除文件",
    /** Toast for a picked file rejected before reading (the server's per-file cap is 10MB). */
    attachmentTooLarge: (name: string): string => `${name} 超过 10MB 上限，未添加。`,
    goalMode: "目标模式",
    goalModeDesc: "循环运行直至目标完成",
    goalBudgetLabel: "Token 预算",
    goalBudgetUnlimited: "预算不限",
    goalBudgetValue: (value: string): string => `预算 ${value}`,
    goalBudgetPlaceholder: "例如 500k",
    goalBudgetHint: "支持 k/m 后缀；留空表示预算不限",
    goalBudgetInvalid: "无效预算：应为正数，可带 k/m 后缀（500k、2m）",
    goalBudgetSave: "保存预算",
    goalRemove: "退出目标模式",
    goalRoundBanner: (round: number): string => `目标 · 第 ${round} 轮`,
    /** Later rounds collapse the objective's images into this chip (round 1 shows them in full). */
    goalRoundImages: (count: number): string => `${count} 张附图`,
    goalProgress: (rounds: number, tokens: string): string => `第 ${rounds} 轮 · tokens ${tokens}`,
    goalStatus: {
      active: "进行中",
      complete: "已完成",
      blocked: "受阻",
      budget_limited: "预算耗尽",
      aborted: "已中断",
    } as Record<string, string>,
  },

  /** Subagents side panel: call-graph of the latest Task + the selected child conversation. */
  subagentPanel: {
    title: "智能体面板",
    topologyLabel: "调用关系",
    mainSessionNote: "主会话请在对话区查看",
    empty: "本次任务尚未派生子智能体",
    nodeRunning: "运行中",
    nodeDone: "已完成",
  },

  files: {
    title: "文件",
    upload: "上传",
    download: "下载",
    openInNewTab: "新页面打开",
    previewNotIsolatedHint:
      "当前访问地址无法提供独立预览源，页面将以沙箱模式打开：localStorage、Cookie 与第三方 embed 不可用。经 127.0.0.1 或 localhost 访问，或配置 PENGUIN_PREVIEW_ORIGIN 即可解除。",
    refresh: "刷新",
    root: "根目录",
    empty: "空目录",
    previewUnsupported: "该类型不支持预览，请下载查看",
    uploaded: "已上传",
    /** Upload-overwrite confirmation: same-name files in the current directory will be replaced. */
    overwriteTitle: "覆盖同名文件",
    overwriteConfirm: (n: number): string => `当前目录已存在以下 ${n} 个同名文件，上传将覆盖：`,
    loadFailed: "加载失败",
    previewTruncated: "内容过大，预览已截断，请下载查看完整文件",
    details: "详情",
    workspacePath: "Workspace 路径",
    htmlRendered: "渲染视图",
    htmlSource: "源码",
    backToList: "返回列表",
    resizeHandle: "拖拽调整宽度，双击恢复默认",
  },

  usage: {
    title: "成本与统计",
    today: "今日",
    last7d: "近 7 天",
    total: "累计",
    tokens: "Token",
    requests: "Requests",
    from: "起始日期",
    to: "结束日期",
    colCacheRead: "cache_read",
    colCacheWrite: "cache_write",
    colOutput: "output",
    uncostedNote: "* 只计入配置了价格的模型成本",
    filterAllAgents: "全部 Agent",
    filterAllModels: "全部模型",
    chartAgentCalls: "各 Agent 调用次数",
    chartSuccessRate: "各模型成功率",
    chartTokenTrend: "Token 逐日变化",
    chartCostTrend: "成本逐日变化",
    empty: "暂无用量记录",
    successAborted: "已中断（不计入）",
    errors: "异常",
    errorsTotal: "总数",
    errorsUnexpected: "未预期",
    errorsExpected: "预期内",
    errorsTopCode: "最常见",
    errorsColCode: "来源 · 错误码",
    errorsColKind: "类型",
    errorsColMessage: "消息",
    errorsEmpty: "暂无异常",
    /** Detail-table pager: newer/older step back through pages of the same filtered set. */
    errorsNewer: "较新",
    errorsOlder: "更早",
    errorsPageOf: (page: number, pages: number, total: number) =>
      `第 ${page} / ${pages} 页 · 共 ${total} 条`,
  },

  traces: {
    title: "轨迹观测",
    timeline: "执行时间线",
    laneLLM: "模型",
    kindThinking: "思考",
    kindModelReply: "模型回复",
    kindToolGen: "工具调用生成",
    legendToolExec: "工具调用执行",
    legendApprovalWait: "审批等待",
    task: (n: number) => `第 ${n} 轮`,
    globalSummary: "全局统计",
    tasksLabel: "轮次",
    messages: "消息",
    truncatedNote: (shown: number, total: number) => `仅展示前 ${shown} / ${total} 条消息`,
    zoom: "缩放",
    zoomReset: "双击复位缩放",
    zoomOut: "缩小",
    zoomIn: "放大",
    linkHint:
      "鼠标移到时间线段或消息行即可联动高亮，点击时间线段跳转到对应消息；图例可高亮同类；拖动下方滑块平移/缩放",
    filesTitle: "Trace 文件",
    selectSession: "在左侧选择一个 Session",
    toolCalls: "工具调用",
    taskInput: "本轮输入 tokens",
    taskOutput: "本轮输出 tokens",
    cacheHit: "命中缓存",
    hitRate: "命中率",
    compactions: "压缩次数",
    compactionRound: "压缩",
    empty: "该 Agent 暂无 Trace",
    inProgress: "进行中",
    systemPrompt: "系统提示词",
    toolDefs: (n: number) => `工具定义（${n}）`,
    exportFile: "导出",
    importTrace: "导入 Trace",
    /** Import dialog: which Agent receives the file (the endpoint is per-Agent). */
    importAgent: "导入到 Agent",
    importPickFile: "选择文件",
    importing: "导入中…",
    /** Client-side pre-check before reading the picked file (same cap as the server's import route). */
    fileTooLarge: "文件超过 14MB 上限。",
  },

  benchmark: {
    title: "评估中心",
    selectBenchmark: "在左侧选择一个 Benchmark",
    emptyAgent: "该 Agent 暂无 Benchmark",
    caseCount: (n: number): string => `${n} 题`,
    /** Score-only chart title. */
    trendTitle: (metric: string): string => `${metric}随时间变化`,
    cases: "题目",
    viewCase: "查看详情",
    taskMaterials: "任务材料",
    rubric: "评分标准",
    agentHidden: "被测 Agent 不可见",
    caseFileUnavailable: "案例文件暂时无法读取",
    evaluations: "评估明细",
    noEvaluations: "暂无评估记录",
    /** Evaluation notes (scoreboard's summary: score source and notes on this round's changes). */
    summaryLabel: "评估说明",
    /** Chart legend: older evaluation records with no model label (gray series). */
    legendUnlabeled: "未标注模型",
    colVersion: "版本",
    colModel: "模型 ID",
    colThinkingLevel: "推理强度",
    colScore: "Score",
    colDuration: "耗时",
    colCase: "题目",
    colRun: "运行",
    colSession: "Session",
  },

  // Server error code → localized copy (the server's message is hardcoded Chinese; this is only a fallback for unknown codes).
  errors: {
    networkError: "网络错误，请检查连接",
    modelCredentialMissing: (modelId: string) =>
      `模型 ${modelId} 还没有可用的 API key，请先在「模型」页为它配置`,
    noDefaultModel: "该 Project 还没有默认模型，请先在「模型」页添加模型并设为默认",
    /** Localized text for the common server error codes (server error messages are English-only); looked up by ApiError.code in apiErrorText, falling back to the raw message for unmapped codes. */
    byCode: {
      invalid_credentials: "用户名或密码错误。",
      too_many_attempts: "登录失败次数过多，请稍后重试。",
      password_mismatch: "当前密码不正确。",
      invalid_password: "密码至少 8 位。",
      admin_required: "仅管理员可执行此操作。",
      not_found: "资源不存在，或你没有访问权限。",
      agent_not_found: "该 Agent 已不存在。",
      unknown_agent: "该 Agent 不存在于本 Project。",
      agent_exists: "该 Agent id 已被占用。",
      project_exists: "该 Project id 已被占用。",
      user_exists: "该用户名已被占用。",
      user_not_found: "该用户已不存在。",
      cannot_delete_admin: "内置 admin 不可删除。",
      member_not_found: "该用户不是本 Project 的成员。",
      schedule_exists: "已存在同名定时任务。",
      schedule_not_found: "该定时任务已不存在。",
      unknown_skill: "该技能不在技能库中。",
      file_not_found: "该文件已不存在。",
      file_too_large: "文件过大。",
      too_many_files: "一条消息附加的文件过多。",
      payload_too_large: "请求体过大。",
      dir_not_absolute: "目录必须是绝对路径。",
      not_a_dir: "该路径不是目录。",
      path_not_found: "该路径不存在。",
      workspace_missing: "该 Session 的 Workspace 已不存在。",
      task_in_progress: "该 Session 已有任务在运行。",
      version_conflict: "快照版本不高于当前版本。",
      invalid_title: "标题无效。",
      invalid_trace: "该文件不是有效的 Trace 文件。",
      trace_session_exists: "该 Agent 已存在同名 Session，无法导入重复的 Trace。",
    },
  },
};

/** Dictionary shape (constrains the English dictionary so keys and function signatures line up). */
export type Strings = typeof zh;

/**
 * Runtime active dictionary (live binding): the locale Provider calls setActiveStrings
 * to switch before render, and remounts the whole tree keyed by locale so every `S.x`
 * read reflects the current language.
 */
export let S: Strings = zh;

export function setActiveStrings(next: Strings): void {
  S = next;
}
