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

  /** Server-side terminal (the in-app dock and the standalone /terminal page). */
  terminal: {
    title: "终端",
    newShell: "新建 Shell",
    /** Tab strip ×: kills the shell itself (server-side), unlike closing the dock. */
    killShell: "关闭此终端",
    /** Pane body when creating/attaching a shell failed (the server message follows). */
    createFailed: "终端创建失败",
    /** A create that 404s: the server predates the terminal API (or the shell attached to an older one). */
    noTerminalApi:
      "该服务端没有终端接口：运行中的 runtime 早于该功能。热更新只替换平台与前端，终端接口属于 runtime，需更新 runtime 本身（重启无效）",
    /** Codex-style handoff: opens /terminal?id=… in a new window, the dock lets go. */
    detach: "在新窗口打开",
    status: {
      connecting: "连接中",
      ready: "已连接",
      exited: "已退出",
      error: "连接错误",
    },
    /** Suffix shown after `status.exited`; `code` is the shell's numeric exit code. */
    exitedWithCode: (code: string): string => `退出码 ${code}`,
  },

  /** The dock surfaces (right / bottom) every side element renders in as a tab. */
  dock: {
    /** The dock header's "+" menu: panels and shells this dock can take a tab for. */
    addTab: "添加面板",
    /** A panel tab's × (its content closes; terminal tabs use terminal.killShell instead). */
    closeTab: "关闭面板",
    /** The dock header's ×: the dock hides, its tabs stay for the next open. */
    hideDock: "收起侧边栏",
    moveToRight: "移到右侧",
    moveToBottom: "移到下方",
    /** Boundary drag handle between a dock and the chat content (double-click resets). */
    resize: "调整面板大小",
    /** The toolbar's two pull-open buttons (aria-expanded carries the open state). */
    rightDock: "右侧栏",
    bottomDock: "下侧栏",
    /** A session-bound panel's body on the draft page, where no Session exists yet. */
    draftEmpty: "发送第一条消息后可用",
    /** Terminal tab ×: ends the shell for real, so it asks first. `name` is the tab label. */
    killConfirmTitle: "关闭此终端？",
    killConfirmBody: (name: string): string => `将结束 Shell「${name}」的进程，无法恢复。`,
  },

  /** The Trace dock panel (the current conversation's Trace files). */
  tracePanel: {
    empty: "暂无轨迹",
    emptyHint: "该会话还没有产生 Trace 文件",
    loadFailed: "轨迹加载失败",
  },

  settings: {
    language: "语言",
    languageInfo: "界面语言，可跟随浏览器设置。",
    /** Sidebar user-menu row opening the System settings dialog. */
    systemSettings: "系统设置",
    /** Rail headings: the viewer's own preferences vs. the whole server's. */
    groupPersonal: "个人",
    groupServer: "服务器",
    /** Personal pages of the settings dialog. */
    generalTitle: "通用",
    appearanceTitle: "外观",
    accountTitle: "账户",
    /** Sidebar Session list: also show CLI-created Sessions (default off — the list then never scans the Trace directories). */
    showCliSessions: "显示 CLI 会话",
    showCliSessionsInfo:
      "关闭时会话列表只列出在 Web 端创建的会话，直接由数据库返回；开启后会额外扫描轨迹目录，把 CLI 创建的会话一并列出。仅影响当前账号。",
    /** Admin-only sub-page (server-global); its explanation is disclosed at the pane heading. */
    proxyTitle: "代理选项",
    proxyInfo: "服务器全局设置，保存后立即生效，无需重启。回环地址始终直连。",
    /** The two switches: the server's own outbound traffic / agent command subprocess environments. */
    proxyForApp: "应用程序使用代理",
    proxyForAgent: "Agent 环境使用代理",
    /** The shared explicit proxy address (empty = follow the proxy environment variables). */
    proxyAddress: "代理地址",
    proxyAddressPlaceholder: "留空 = 跟随系统代理",
    /** Admin-only sub-page (server-global). */
    uploadLimitsTitle: "上传限制",
    /** Its two number fields, both in whole MB. */
    attachmentMaxMb: "单个附件上限（MB）",
    attachmentTotalMb: "单条消息附件合计上限（MB）",
    /** Accepted range for each field: read while typing, so it stays under the field. */
    attachmentMaxMbHint: (min: number, max: number): string => `取值 ${min}–${max} MB`,
    attachmentTotalMbHint: (min: number, max: number): string =>
      `取值 ${min}–${max} MB，且不得低于单个附件上限`,
    /** What these two numbers do NOT govern — disclosed at the pane heading. */
    uploadLimitsInfo: (count: number, imageMb: number): string =>
      `一条消息最多 ${count} 个附件；对话内嵌图片另有 ${imageMb}MB 上限，不随此设置变化——` +
      `图片会进入对话与轨迹，每次翻阅历史与恢复会话都要重新付出它的体积。`,
    theme: "主题",
    themeInfo: "应用的明暗外观。",
    themeLight: "浅色",
    themeDark: "深色",
    followSystem: "跟随系统",
    terminalTheme: "终端主题",
    terminalThemeInfo: "终端面板的配色，默认跟随应用主题。",
    followAppTheme: "跟随主题",
    langZh: "中文",
    langEn: "English",
    fontSize: "字号",
    fontSizeInfo: "界面整体字号。",
    fontSmall: "小",
    fontMedium: "中",
    fontLarge: "大",
    accent: "主题色",
    accentInfo: "界面强调色。",
    currencyInfo: "价格显示币种；存储始终为美元。",
    changePasswordInfo: "更改当前账号的登录密码。",
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
    /** Version-line date label (owner-specified wording); `date` is formatMonthDay output. */
    lastUpdated: (date: string) => `最近更新日期 ${date}`,
    /** Superscript badge on the version lines when the update check found a newer release (owner-specified wording). */
    newVersionBadge: "有新版本可用",
    newVersion: (v: string) => `新版本 v${v} 可用`,
    /**
     * The sidebar user menu's SINGLE update row: it reads checkNow until a newer release
     * is known and runs the manual check; once one is known it reads newVersion() and
     * opens the update dialog instead (which carries the release-notes link and, for
     * admins, the self-update action).
     */
    checkNow: "检查更新",
    checking: "检查中…",
    /** Success toast when the manual check finds a newer release; the row itself turns into the update entry. */
    foundNew: (v: string) => `发现新版本 v${v}，点击该更新入口即可安装`,
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
    /** Copy shown to non-admins in place of confirmBody (they can read the release notes but cannot run the update here). */
    adminOnly: "只有管理员可以在这里执行更新。",
    /**
     * Desktop client-update row in the sidebar user menu (shell window only): check →
     * download progress → restart-to-install, driven by the shell's updater snapshot.
     * It stands in for the server update surface, which desktop mode hides entirely.
     * Null version/percent = the shell didn't name one.
     */
    clientCheckNow: "检查更新",
    /** Success toast when a row-initiated check finds a release (the download starts by itself). */
    clientFoundNew: (v: string | null) =>
      v !== null ? `发现新版本 v${v}，正在后台下载…` : "发现新版本，正在后台下载…",
    clientDownloading: (v: string | null, percent: number | null) =>
      `${v !== null ? `v${v} ` : ""}下载中…${percent !== null ? ` ${percent}%` : ""}`,
    clientRestartToInstall: (v: string | null) =>
      v !== null ? `重启并安装 v${v}` : "重启并安装更新",
    /** Success toast when a row-initiated check lands on a build already downloaded and waiting. */
    clientDownloadReady: (v: string | null) =>
      v !== null ? `新版本 v${v} 已就绪，可重启安装` : "更新已就绪，可重启安装",
    /** Error toast carrying the shell's own updater failure text — a failed download or signature check, not only a failed lookup. */
    clientUpdateFailed: (detail: string) => `客户端更新失败：${detail}`,
    /** Install POST failed before the shell could act; `detail` is apiErrorText output. */
    clientInstallFailed: (detail: string) => `无法开始安装：${detail}`,
    clientInstallConfirmTitle: "重启并安装更新",
    /** Mirrors the shell's native restart prompt: the interruption warning must not disappear on the web path. */
    clientInstallConfirmBody: "PenguinHarness 将重启以完成更新，正在运行的任务会被打断。",
    clientInstallConfirmAction: "立即重启",
    /** Tooltip on the disabled row in a dev (unpackaged) run. */
    clientUnsupportedDev: "开发运行不支持自更新",
    /** Tooltip on the disabled row for installs owned by the system package manager (e.g. .deb). */
    clientUnsupportedPackage: "此安装由系统包管理器管理，请通过包管理器更新",
  },

  /** Desktop task-completion notifications (window unfocused; desktop-shell sessions only). */
  notify: {
    taskCompleteTitle: "任务完成",
    /** `session` is the Session title (defaultSessionTitle when unnamed). */
    taskCompleteBody: (session: string): string => `「${session}」已完成，点击查看`,
  },

  common: {
    save: "保存",
    cancel: "取消",
    close: "关闭",
    create: "创建",
    delete: "删除",
    edit: "编辑",
    settings: "设置",
    confirm: "确认",
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
    /** Accessible name of the circled "?" that discloses a section or field explanation. */
    moreInfo: "说明",
    /** The same, named for what it explains — so the trigger never repeats the heading it sits in. */
    moreInfoAbout: (subject: string) => `说明：${subject}`,
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
    /** 左下角账户菜单：换一个账号登录（当前会话暂存，可随时切回）。 */
    switchAccount: "切换账号",
    /** 菜单/登录页上"已登录、点一下即可切过去"的账号分组（凭证在服务端暂存，免密）。 */
    signedInAccounts: "已登录的账号",
    /** 登录页上本机记住过、但当前没有会话的账号（只有用户名，没有密码）。 */
    recentAccounts: "最近登录的账号",
    forgetAccount: (userId: string): string => `不再记住 ${userId}`,
    switchFailed: "该账号的登录状态已失效，请重新登录",
    admin: "管理员",
    /** 登录页顶部的机器分组（列表来自 server 端 /api/machines,桌面模式免会话）。 */
    machines: "机器",
    /** 机器搜索框：ssh config 可能有几百台,默认只显示已连接/最近连接的几台。 */
    machineSearch: "搜索机器…",
    machineMore: (n: number): string => `还有 ${n} 台，输入名称筛选`,
    machineNoMatch: "没有匹配的机器",
    /** 自连守卫:选中的 alias 解析到当前 server 所在的机器和账户。 */
    machineSelf: "这个地址就是当前服务器所在的机器和账户，无需连接",
    /** 首次安装的远端:内置管理员的初始密码在跳转前展示一次,否则登录页无从进入。 */
    machineInitialTitle: "远端的首次登录密码",
    machineInitialNote: "这台机器是首次安装，用下面的内置管理员账号登录，登录后请尽快修改密码：",
    machineGo: "前往登录",
    /** 从别的机器切过来时,回到来源机器的入口。 */
    machineBack: (host: string): string => `返回 ${host}`,
    /** 连接进行中的提示（探测/安装/起服务/开隧道都会走一遍）。 */
    machineConnecting: (machine: string): string => `正在连接 ${machine}…`,
    machineConnected: (machine: string): string => `已连接 ${machine}，正在跳转…`,
    /** 远端 server 的端口在本机被占用,重启它才能连（会打断那边正在跑的东西）。 */
    machineRestartTitle: "需要重启远端服务",
    machineRestartConfirm: (machine: string): string =>
      `${machine} 上的服务所用端口在本机被占用。重启它换到空闲端口才能连接,那台机器上正在运行的任务会被打断。`,
    machineRestart: "重启并连接",
    defaultAdminNote:
      "首次使用请以内置管理员 admin 登录，初始密码在服务端首次启动时打印（形如 penguin-1234），登录后请尽快修改密码",
    /** Login footer line 2: the offline rescue for a forgotten admin password (other users ask the admin instead). */
    forgotAdminNote:
      "忘记管理员密码时，停止服务后执行 penguin server reset-admin-password 重置为新的初始密码",
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
    displayName: "显示名",
    /** Create dialog only: leaving the name empty falls back to the id. In Project settings the saved name cannot be blanked. */
    displayNameHint: "留空则使用 Project id 作为名称",
    settings: "Project 设置",
    settingsTitle: "Project 设置",
    members: "成员",
    addMember: "添加成员",
    removeMember: "移除",
    /** New-conversation defaults section (Project settings): prefills each new conversation's agent / working directory / approval mode / thinking level / default model. */
    chatDefaultsTitle: "新对话默认值",
    chatDefaultsHint: "新建对话时预填的默认值：Agent、工作目录、审批模式、思考等级与默认模型。",
    chatDefaultsAgent: "Agent",
    chatDefaultsNotSet: "未设置",
    chatDefaultsApprovalNotSet: "未设置（默认全部放行）",
    chatDefaultsThinkingNotSet: "未设置（跟随智能体配置）",
    /** The model default shares its source with the Models page (the same default_model); this is just another entry point. */
    chatDefaultsModelHint: "与模型页的默认模型同步",
    /** Settings dialog tab rail. */
    settingsTabGeneral: "通用",
    settingsTabMembers: "成员",
    settingsTabDefaults: "默认值",
    settingsTabSecurity: "安全策略",
    projectIdLabel: "Project ID",
    deleteProjectDesc: "项目目录将被递归删除，不可恢复。",
    /** Security-policy page (Project settings): disclosed by the "?" beside the tab heading. */
    commandPolicyInfo:
      "命令文本经空白与引号归一化后逐条匹配已启用规则的正则表达式，命中即拒绝执行，不受审批模式影响。这是防事故的护栏：运行期才拼出的命令不在覆盖范围内。",
    commandPolicyEnable: "启用策略",
    commandPolicyEnableDesc: "关闭后所有规则都不再拦截。",
    commandPolicyRules: "规则",
    commandPolicyRestore: "恢复默认",
    commandPolicyAddRule: "添加规则",
    commandPolicyEditRule: "编辑",
    commandPolicyApplyRule: "确定",
    commandPolicyEmpty: "没有规则。",
    commandPolicyOn: "已启用",
    commandPolicyOff: "已停用",
    commandPolicyRuleName: "名称",
    commandPolicyRulePattern: "正则表达式",
    commandPolicyRuleDesc: "描述",
    commandPolicyInvalidPattern: "正则表达式无效",
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
    copyId: "复制 Agent id",
    nameHint: "留空则使用 Agent id 作为名称",
    description: "描述",
    sessionCount: (n: number): string => `${n} 个 Session`,
    toolCount: (n: number): string => `${n} 个工具`,
    vaultKeyCount: (n: number): string => `${n} 个密钥`,
    scheduleCount: (n: number): string => `${n} 个定时任务`,
    memoryCount: (n: number): string => `${n} 条记忆`,
    updatedAt: "最后修改",
    activity: (days: number): string => `近 ${days} 天 Session 活跃度`,
    settings: "Agent 设置",
    backToList: "返回 Agents",
    tabOverview: "概览",
    tabPrompt: "系统提示词",
    tabMemory: "记忆",
    tabRuntime: "运行参数",
    tabTools: "工具",
    tabSkills: "技能",
    tabVault: "密钥保险柜",
    tabSchedules: "定时任务",
    stateDir: "State 路径",
    copyStateDir: "复制 State 路径",
    agentsMd: "AGENTS.md",
    systemPrompt: "system_prompt 模板",
    placeholdersTitle: "可用占位符（点击插入）",
    insertPlaceholder: "插入到 system_prompt 光标处",
    /** Order must match the default system prompt (core default-config.ts DEFAULT_SYSTEM_PROMPT). Inner tokens ({{VAULT_KEYS}} 等) live in each feature tab's promptPlaceholders instead. */
    placeholders: [
      ["{{AGENTS_MD}}", "注入 AGENTS.md 内容"],
      ["{{VAULT}}", "注入保险柜区块（vault.prompt，含键名清单）；开关关闭时为空"],
      ["{{SKILLS}}", "注入技能区块（skills.prompt，含已安装技能元数据）；开关关闭时为空"],
      [
        "{{MEMORY}}",
        "注入记忆区块：memory.prompt 加 memory.workspace_prompt（仅持久工作区）；关闭记忆时为空",
      ],
      ["{{SCHEDULES}}", "注入定时任务区块（schedules.prompt，含任务名清单）；开关关闭时为空"],
      ["{{PLATFORM}}", "运行平台"],
      ["{{OS_VERSION}}", "操作系统版本"],
      ["{{SHELL}}", "命令执行使用的 Shell"],
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
      ["xhigh", "在 high 之上再进一步的扩展推理，部分模型上效果与 high 相同。"],
      ["max", "开启最高强度的扩展推理，最慢，部分模型上效果与 xhigh 相同。"],
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
    mcpServers: "MCP Server",
    mcpDesc:
      "连接外部 MCP Server：其工具以 mcp__<name>__<tool> 并入本 Agent 的工具列表。此区块的改动即时保存。",
    mcpEmpty: "尚未配置 MCP Server",
    mcpAdd: "添加 MCP Server",
    mcpEditTitle: "编辑 MCP Server",
    mcpRemove: "删除",
    mcpName: "name",
    mcpNameHint: "工具名前缀：mcp__<name>__<tool>；限字母、数字、_ 和 -",
    mcpTransport: "transport",
    mcpTransportStdio: "本地进程：启动 command 后经 stdin/stdout 通信",
    mcpTransportHttp: "Streamable HTTP：当前规范的远程 transport",
    mcpTransportSse: "旧版 HTTP+SSE：仅为未迁移的服务保留",
    mcpTarget: "command / url",
    mcpCommand: "command",
    mcpArgs: "args",
    mcpArgsHint: "每行一个参数",
    mcpEnv: "env",
    mcpEnvHint: "每行一条 KEY=value；Agent vault 不注入 MCP Server 进程",
    mcpCwd: "cwd",
    mcpCwdHint: "留空则使用本次 Session 的 Workspace",
    mcpUrl: "url",
    mcpHeaders: "headers",
    mcpHeadersHint: "每行一条 Header-Name: value（如 Authorization 等认证头）",
    mcpPermission: "permission",
    mcpPermissionAuto: "auto",
    mcpPermissionAutoLabel: "Auto（readOnlyHint）",
    mcpPermissionAutoDescription:
      "每个工具按自己的 readOnlyHint 注解取值：声明了就是只读，否则为读写。",
    mcpPermissionReadDescription:
      "该 Server 的全部工具一律视为只读，无论其自身声明。审批模式为 read-only 时自动放行。",
    mcpPermissionReadWriteDescription:
      "该 Server 的全部工具一律视为读写，无论其自身声明。审批模式为 read-only 时需人工确认。",
    mcpPermissionHint:
      "只有 read-only 审批模式会读这个等级，allow-all / deny-all / always-ask 一律不看。它不限制 Server 本身能做什么——把并非只读的 Server 标为只读，只是撤掉了 read-only 模式本会索要的那次确认。",
    mcpConnectTimeout: "connectTimeoutMs",
    mcpBudgetsHint:
      "留空使用默认值：connectTimeoutMs 是连接与工具发现预算（默认 10000）；timeoutMs / maxOutputLength 作用于该 Server 的全部工具。",
    mcpNameInvalid: "限字母、数字、_ 和 -，且以字母或数字开头",
    mcpUrlInvalid: "必须是合法的 http(s) URL",
    mcpLineInvalid: (line: number): string => `第 ${line} 行格式无效`,
    mcpNumberInvalid: "必须是 > 0 的整数",
    mcpDuplicateName: "同名 Server 已存在",
    mcpTest: "测试连接",
    mcpTesting: "测试中…",
    mcpTestOk: (toolCount: number, latencyMs?: number): string => {
      const timing = latencyMs !== undefined ? `（${(latencyMs / 1000).toFixed(1)}s）` : "";
      return toolCount === 0
        ? `连接成功，但该 Server 未暴露任何工具${timing}`
        : `连接成功，发现 ${toolCount} 个工具${timing}`;
    },
    mcpTestFail: (detail: string): string => `连接失败：${detail}`,
    mcpTestAllConfirm: (n: number): string =>
      `将逐一连接已配置的 ${n} 个 MCP Server 并做工具发现（真实连接，不保存任何改动），结果显示在各行上。`,
    mcpTestAllStart: "开始测试",
    mcpTestPending: "测试中…",
    mcpTestBadge: (toolCount: number, latencyMs?: number): string =>
      `${toolCount} 个工具${latencyMs !== undefined ? ` · ${(latencyMs / 1000).toFixed(1)}s` : ""}`,
    mcpTestBadgeFail: "连接失败",
    mcpDeleteTitle: "删除 MCP Server",
    mcpDeleteConfirm: (name: string): string =>
      `确认删除 MCP Server「${name}」？其工具自下次 Session 起不再可用。`,
    defaultValue: "（缺省）",
    /** Reset link next to the runtime dropdowns: rewinds the local pick back to "not overridden" (the menus offer no inherit row). */
    deleteAgent: "删除 Agent",
    builtinUndeletable: "内置 Agent 不可被删除",
    deleteConfirm: (name: string): string =>
      `确认删除 Agent「${name}」？其目录（含全部 Trace）将被递归删除，不可恢复。`,
    /** Agent State section: the State version with the snapshot transfer actions, plus the copyable State path. */
    stateTitle: "Agent State",
    stateVersion: "Agent State 版本",
    transferDesc: "导出当前 Agent State 快照包（tar.gz）；导入整目录覆盖，并以包内版本为准。",
    exportSnapshot: "导出快照",
    importSnapshot: "导入快照",
    importing: "导入中…",
    importDone: (v: number): string => `导入完成，Agent State 版本 v${v}`,
    importConflictTitle: "版本冲突",
    importConflictBody: "快照包版本不高于当前版本，导入将覆盖现有 Agent State。确认继续？",
    resetConfigTitle: "还原为默认配置",
    resetConfigAction: "还原为默认配置",
    resetConfigConfirmBody:
      "此操作会用当前默认值覆盖该 Agent 的现有配置：自定义系统提示词、工具列表、模型/压缩参数与 MCP Server 全部被替换，仅保留名称与描述。与 Skill 更新一样不可撤销，确认继续？",
    resetConfigDone: "配置已还原为当前默认值",
    /** Kernel section: which defaults generation the config is based on (dates; unrelated to the optimization counter shown as stateVersion), with the update / restore actions. */
    kernelTitle: "内核",
    kernelLegacy: "早于内核版本机制",
    kernelOutdatedHint: "内核有更新",
    kernelUpToDate: "已是最新",
    kernelUpdateTitle: "更新内核",
    /** Inline labels around the outdated line's two generation values (the values themselves render dark and semibold). */
    kernelCurrent: "当前",
    kernelLatest: "最新",
    kernelUpdateAction: "更新内核",
    kernelUpdateConfirmBody:
      "将把未自定义的字段更新为当前内置默认值；自定义过的字段保持不变并在结果中列出。名称、描述、版本号与 MCP Server 不受影响。确认继续？",
    kernelUpdateDone: (version: string, advanced: number): string =>
      advanced > 0
        ? `内核已更新至 ${version}，${advanced} 个字段跟进新默认`
        : `内核已更新至 ${version}，字段均已是当前默认或保持自定义`,
    kernelUpdateKeptIntro: "以下字段因自定义被保留：",
    kernelListSeparator: "、",
    /** Display name of a per-tool merge leaf (`tools.builtin.<name>`) in the kept/advanced lists. */
    kernelFieldTool: (name: string): string => `工具 ${name}`,
    /** Display names of the fixed kernel merge leaves (dotted config paths); unknown paths fall back to the raw path. */
    kernelFields: {
      system_prompt: "系统提示词模板",
      max_turns: "单任务最大轮数",
      "model.max_tokens": "模型最大输出 Token",
      "model.thinking_level": "思考力度",
      "model.timeoutMs": "请求超时",
      "compaction.max_context_length": "压缩上下文阈值",
      "compaction.max_session_turns": "压缩会话轮数阈值",
      "compaction.mode": "压缩模式",
      "compaction.prompt": "压缩提示词",
      "memory.enabled": "记忆开关",
      "memory.prompt": "记忆提示词",
      "memory.workspace_prompt": "工作区记忆提示词",
      "vault.enabled": "Vault 小节开关",
      "vault.prompt": "Vault 提示词",
      "skills.enabled": "技能小节开关",
      "skills.prompt": "技能提示词",
      "schedules.enabled": "定时任务小节开关",
      "schedules.prompt": "定时任务提示词",
    } as Record<string, string>,
  },

  models: {
    title: "模型配置",
    addCustom: "添加自定义模型",
    addToGroup: "新增模型",
    editTitle: "模型配置",
    addTitle: "新增模型（OpenAI 协议）",
    addTitleVendor: "新增模型",
    addProtocolHint: "新增模型走 OpenAI Chat Completions 兼容协议，base URL 填其兼容端点",
    /** Add-dialog note for preset direct-vendor groups (fed the provider label): states whose protocol the group speaks — the in-field suffix on the base URL shows which path. */
    vendorProtocolHint: (vendor: string): string =>
      `仅支持 ${vendor} 官方接口协议，OpenAI 兼容接口请使用自定义模型分组`,
    autoRouteNone: "该模型 ID 无法按当前厂商协议识别；若使用 OpenAI 兼容接口，可转为自定义模型。",
    useCustomGroup: "转为自定义模型",
    addGroup: "新增分组",
    addGroupTitle: "新增分组",
    addGroupDesc:
      "自建分组与 Custom 同语义。「导入模型」按端点检测或手选协议后，一键导入其全部模型；「仅新增分组」建组后逐个添加。分组由模型条目承载，保存首个模型后即出现。",
    groupModeCreate: "仅新增分组",
    groupModeImport: "导入模型",
    groupImportAll: "批量导入模型",
    groupImportNeedUrl: "请先填写有效的 base URL（http/https）",
    groupImportKeyHint: "留空按协议读取 OPENAI_* / ANTHROPIC_* 环境变量",
    groupImportListing: "正在获取模型列表…",
    groupImportSaving: (n: number): string => `正在导入 ${n} 个模型…`,
    groupImportUnsupported: "该协议不支持列出模型，请手动添加",
    groupImportFailed: "获取模型列表失败",
    groupImportEmpty: "该端点没有可导入的模型",
    groupImported: (added: number, skipped: number): string =>
      skipped > 0 ? `已导入 ${added} 个模型，跳过 ${skipped} 个条目` : `已导入 ${added} 个模型`,
    groupNameLabel: "分组名",
    groupNameHint: "小写字母 / 数字开头，可含 - 与 _",
    groupNameInvalid: "分组名只能用小写字母、数字、- 与 _（首字符为字母或数字），长度不超过 32",
    groupNameExists: "该分组名已被内置分组或既有条目占用",
    groupEmptyHint: "该分组暂无模型，点「新增模型」添加",
    deleteGroup: "删除分组",
    deleteGroupTitle: "删除分组",
    deleteGroupConfirm: (label: string, n: number): string =>
      `确定删除分组「${label}」？组内 ${n} 个模型及其 API key 配置将一并移除。`,
    groupDeleted: (n: number): string => `已删除分组（${n} 个模型）`,
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
    /** Unit suffix shown inside the right edge of the context-window / max-output-length inputs. */
    tokenUnit: "Token",
    contextWindowHint: "留空表示未知",
    maxTokens: "最大输出长度",
    /** Placeholders cannot scroll, so this must fit the half-width box; the full guidance is the input's title tooltip (the owner prefers no visible hint line — saves vertical space). */
    maxTokensHint: "留空沿用 Agent 设置",
    maxTokensTitle:
      "按模型限制单次请求的最大输出 Token 数；留空沿用 Agent 设置，小上下文模型建议调低",
    maxTokensInvalid: "必须为正整数",
    clientTypeLocked: (t: string): string => `协议：${t}（沿用原配置，不可修改）`,
    /** Protocol selector (custom / user-defined groups): AgentHub's generic protocol clients. Protocol names are proper nouns, identical in both locales. */
    protocol: "接口协议",
    protocolNames: {
      "openai-responses": "OpenAI Responses",
      "ant-messages": "Anthropic Messages",
      "openai-chat": "OpenAI Chat Completions",
    } as Record<string, string | undefined>,
    /** Hover title on the in-field protocol picker (the base URL field's right-edge suffix). */
    protocolTriggerTitle: (name: string): string => `接口协议：${name}。点击可更换。`,
    /** Suffix placeholder while no protocol is selected — 不显示任何协议名，避免看起来已选好。 */
    protocolUnset: "选择协议",
    /** Detect button at the base URL field's top-right. */
    detectProtocol: "检测协议",
    /** Hover title on the detect button. */
    detectProtocolHint: "探测 base URL，采用它实际提供的协议",
    detecting: "检测中…",
    /** Success toast；协议本身随后显示在 base URL 输入框的后缀处。 */
    detectedProtocol: (name: string): string => `检测到 ${name} 协议，已应用`,
    /** The ONE failure toast: 所有失败情形共用，只讲用户能动手改的两件事。 */
    detectFailedBody: "无法检测接口协议，请检查 API Key 与 base URL。",
    /** 保存时检测无结果：按兼容协议继续保存。 */
    detectFellBack: "未检测到协议，已按 OpenAI Chat Completions 保存",
    /** Add-dialog note for custom / user-defined groups (protocol selectable): replaces the fixed-OpenAI wording. */
    addProtocolHintDetect:
      "可在 base URL 输入框右端的后缀处手动选择接口协议（OpenAI Responses / Anthropic Messages / OpenAI Chat Completions），也可点“检测协议”探测端点；未选协议时保存会先自动检测",
    addTitleCustom: "新增模型",
    /** Switch label only — the dialog carries no explanation text for it (per owner). */
    vision: "支持视觉",
    /** Detect action beside the vision switch. */
    detectVision: "检测",
    detectingVision: "测试中…",
    detectVisionHint: "发送一张极小的测试图片，判断该模型是否接受图片输入(会消耗 API Key 额度)",
    detectVisionNeedsId: "请先填写模型 id，再进行检测。",
    detectVisionOk: "该模型接受图片输入，已开启视觉",
    detectVisionNo: "该模型不接受图片输入，视觉保持关闭",
    /** Shown only while the vision switch is OFF: images are then read via the configured vision proxy model (describe_image). */
    visionOffProxyHint: "使用视觉代理模型读图",
    /** Switch label for the per-model fast mode (the provider's premium faster serving tier); the switch is only rendered for models whose AgentHub client can carry the parameter. */
    fastMode: "快速模式",
    /** Shown while the fast-mode switch is ON (and as the label's hover title): what it buys, and that the recorded prices do not follow the premium rate. */
    fastModeHint: "输出更快，按厂商的溢价档位计费；成本中心仍按条目记录的标准单价统计",
    /** Amber line under an ON switch on a model whose client rejects the parameter (a hand-edited config or a renamed id): the switch stays visible only so it can be turned off. */
    fastModeUnsupported: "该模型不支持快速模式，请关闭，否则请求会失败",
    /** Accessible name of the warning dialog raised when the fast-mode switch is turned ON. */
    fastModeConfirmTitle: "开启快速模式",
    /** Body of that warning: premium billing, and that the recorded prices do not follow it. */
    fastModeConfirmBody:
      "快速模式按厂商的溢价价目计费（MiniMax 为标准价的 1.5 倍，OpenAI 与 Anthropic 另有溢价价目表）。条目记录的按 Token 单价不会随之调整，成本中心会低估这部分用量。",
    /** Extra paragraph shown only for Anthropic-protocol models: fast mode there is a gated research preview. */
    fastModeConfirmPreview:
      "Anthropic 的快速模式目前是限量的 research preview：在你的组织获得授权之前，请求会返回 429 限流错误。",
    /** Badge on a model row whose fast mode is on: a standing premium-billing choice should be visible without opening the dialog. */
    fastModeBadge: "快速",
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
    /** Hover title for the base URL field: explains the in-field suffix (the protocol path the client appends to the base URL); for custom groups that suffix is also the protocol picker. */
    baseUrlSuffixTitle: "客户端会在 base URL 后追加字段右侧的协议路径",
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
    /**
     * Model dialog credential slot: sits where a stored key shows its created-at line. It
     * names no variable — the slot next to it already shows that variable's value masked,
     * which is what identifies the key to the reader.
     */
    readFromEnv: "读取自环境变量",
    /** Chat model dropdown's bottom expander row: reveals the models hidden by the configured-key filter. */
    showModelsWithoutKey: (n: number): string => `显示未配置 key 的模型（${n} 个）`,
    modelIdExists: "该模型 id 已存在",
    pricingAllOrNone: "三项价格需一并填写",
    pricingInvalid: "必须为数字",
    contextWindowInvalid: "必须为数字",
  },

  memory: {
    desc: "跨 Session 的长期记忆（存于 agent_state/memory/）：agent 会在对话中自行记下值得保留的信息，你也可以直接让它记住某件事。用户记忆对本 Agent 的所有会话生效，工作区记忆按工作区隔离；记忆修改在对话中由 agent 完成。关闭开关只停止使用记忆，不删除任何文件。",
    enable: "启用记忆",
    userScope: "用户记忆",
    templateMissing: "提示词模板中没有 {{MEMORY}} 占位符，记忆不会进入上下文。",
    insertPlaceholder: "插入 {{MEMORY}} 占位符",
    insertPlaceholderDone: "已插入",
    promptSection: "记忆提示词",
    promptSectionHint:
      "注入模板 {{MEMORY}} 占位符的内容。主提示词每个会话都注入；工作区附加段仅在持久工作区的会话中追加。",
    promptLabel: "主提示词",
    workspacePromptLabel: "工作区附加段",
    /**
     * Memory-prompt placeholder reference; a chip inserts into whichever field was focused
     * last. The two indexes plus the workspace directory — the user directory stays a literal
     * pattern in the prompt, resolvable from the Environment section.
     */
    promptPlaceholders: [
      [
        "{{USER_MEMORY_INDEX}}",
        "用户记忆索引 MEMORY.md 的内容（最多注入 200 行、总计 25000 字符）",
      ],
      [
        "{{WORKSPACE_MEMORY_INDEX}}",
        "当前工作区记忆索引的内容（最多注入 200 行、总计 25000 字符）；仅在工作区附加段生效",
      ],
      ["{{WORKSPACE_MEMORY_DIR}}", "当前工作区记忆目录的绝对路径；仅在工作区附加段生效"],
    ],
    insertToken: "插入到光标处",
    itemCount: (n: number): string => `${n} 条`,
    emptyScope: "这个工作区还没有记忆——agent 会在会话中自行记下值得保留的信息",
    emptyUserScope: "还没有用户记忆——在对话里说「记住……」即可让 agent 保存",
    add: "添加",
    addTitle: "添加记忆",
    addWhy: "记忆整理由 agent 在对话中完成：填写内容后打开新对话，由 agent 整理保存。",
    addContentLabel: "要记住的内容或来源",
    addContentPlaceholder: "粘贴要记住的内容，或文件路径 / 链接",
    /** Prefilled draft for the add-via-chat flow, per scope kind; the required content follows on the next line. */
    addPromptLead: {
      user: "请把下面的内容整理成记忆，存入用户记忆：",
      workspace: "请把下面的内容整理成记忆，存入这个工作区的记忆：",
    },
    view: "查看",
    edit: "编辑",
    editTitle: "编辑记忆",
    editWhy:
      "内容修改由 agent 在对话中完成：确认引导语后打开新对话，agent 会同步更新记忆文件与 MEMORY.md 索引。",
    editRequirementLabel: "修改要求",
    editRequirementPlaceholder: "描述要怎么改，跳转后可在对话中补充",
    editPromptLabel: "引导语预览",
    editCopyPrompt: "复制 Prompt",
    editOpenChat: "打开新对话",
    delete: "删除",
    deleteTitle: "删除这条记忆？",
    deleteConfirm: (name: string): string =>
      `将删除「${name}」并移除 MEMORY.md 中对应的索引行。此操作不可恢复。`,
    deleteDone: "已删除",
    /** Prefilled draft for the edit-via-chat flow; the user completes the trailing requirement line before sending. */
    editPromptLead: (title: string): string => `请帮我更新一条记忆：${title}`,
    editPromptTail: "修改要求：",
    exportScope: "导出",
    exportScopeHint: "将该组全部记忆下载为一份 JSON 文档",
    exportScopeLabel: (scope: string): string => `导出${scope}`,
    importScope: "导入",
    importScopeHint: "从导出的 JSON 文档恢复记忆到该组",
    importScopeLabel: (scope: string): string => `导入到${scope}`,
    importTitle: "导入记忆",
    importWhy:
      "读取从本 agent 或其他 agent 导出的一组记忆：一个 JSON 文件，含这组记忆与它的 MEMORY.md 索引。",
    importFile: (name: string, count: number): string => `${name} —— ${count} 条记忆`,
    importModeLabel: "当这一组里已有同名记忆时",
    importModeSkip: "保留现有的这条",
    importModeSkipHint: "只添加这一组还没有的记忆，不会丢失任何现有内容。",
    importModeOverwrite: "改用文件里的版本",
    importModeOverwriteHint: "文件中没有的记忆保持不变。",
    importModeReplace: "整组替换",
    importModeReplaceHint: "文件中没有的记忆将被删除。",
    importAction: "导入",
    importInvalidFile: "这个文件不是记忆导出文件。",
    importEmptyFile: "这个文件里没有记忆。",
    importConfirmTitle: "确认导入",
    importWillOverwrite: (names: string[]): string =>
      `将覆盖 ${names.length} 条记忆：${names.join("、")}`,
    importWillRemove: (names: string[]): string =>
      `将删除 ${names.length} 条记忆：${names.join("、")}`,
    importWillReplaceIndex: "这一组的 MEMORY.md 索引将被替换。",
    importIrreversible: "此操作不可恢复。",
    importDone: (added: number, overwritten: number, removed: number): string =>
      `已导入：新增 ${added} 条，覆盖 ${overwritten} 条，删除 ${removed} 条`,
    importNothingNew: "没有可导入的内容——文件里的记忆这一组都已经有了",
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
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "启用密钥保险柜",
      templateMissing: "提示词模板中没有 {{VAULT}} 占位符，保险柜小节不会进入上下文。",
      legacyTemplate:
        "模板仍是旧版硬编码的 # Vault 段落：一键迁移会将该段落原位替换为 {{VAULT}} 占位符，措辞不变，此后可在下方编辑。",
      insertPlaceholder: "插入 {{VAULT}} 占位符",
      migrate: "迁移为 {{VAULT}} 占位符",
      promptSection: "保险柜提示词",
      promptSectionHint: "注入模板 {{VAULT}} 占位符的内容；开关关闭或模板无占位符时不注入。",
      promptLabel: "提示词",
      promptPlaceholders: [
        ["{{VAULT_KEYS}}", "保险柜键名列表（每键一行「- KEY」，仅键名，值永不注入；无键时为空）"],
      ] as ReadonlyArray<readonly [string, string]>,
    },
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
    endAt: "结束时间",
    period: "周期",
    periodPlaceholder: "30m / 12h / 7d，留空为一次性",
    target: "目标",
    targetNew: "每次新建会话",
    targetSession: "绑定 Session",
    sessionId: "Session",
    /** Bind-Session picker (searchable dropdown): trigger placeholder, search box, and empty states. */
    chooseSession: "选择要绑定的 Session",
    sessionSearch: "搜索标题或 Session id…",
    sessionNoMatch: "无匹配的 Session",
    sessionEmpty: "该 Agent 暂无 Session",
    workspace: "Workspace",
    model: "Model",
    modelDefault: "Project 默认",
    deleteTitle: "删除定时任务",
    deleteConfirm: (name: string): string => `确认删除定时任务「${name}」？`,
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "启用定时任务",
      templateMissing: "提示词模板中没有 {{SCHEDULES}} 占位符，定时任务小节不会进入上下文。",
      insertPlaceholder: "插入 {{SCHEDULES}} 占位符",
      promptSection: "定时任务提示词",
      promptSectionHint:
        "注入模板 {{SCHEDULES}} 占位符的内容，教模型用文件工具管理定时任务；开关关闭或模板无占位符时不注入。",
      promptLabel: "提示词",
      promptPlaceholders: [
        ["{{SCHEDULE_LIST}}", "现有任务名列表（每任务一行「- 名称」；无任务时注入空清单说明）"],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  skills: {
    pageTitle: "技能库",
    pageDesc: "内置 Skill 库：浏览、快捷调用，或安装到 Agent。",
    quickInvoke: "快捷调用",
    /** Pre-filled body for quick invoke (per UI language; English is `use the <name> skill`). */
    quickInvokeText: (name: string): string => `使用 ${name} 技能`,
    /** Title on a disabled quick-invoke button: quick invoke opens a draft on the currently selected agent, so a skill it hasn't installed (e.g. preinstall:false skills like remote-claude-code) can't be quick-invoked until it's installed on that agent. */
    quickInvokeNeedsInstall: "先在当前 Agent 安装该技能后才能快捷调用",
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
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "启用技能",
      templateMissing: "提示词模板中没有 {{SKILLS}} 占位符，技能小节不会进入上下文。",
      legacyTemplate:
        "模板仍是旧版硬编码的 # Skills 段落：一键迁移会将该段落原位替换为 {{SKILLS}} 占位符，措辞不变，此后可在下方编辑。",
      insertPlaceholder: "插入 {{SKILLS}} 占位符",
      migrate: "迁移为 {{SKILLS}} 占位符",
      promptSection: "技能提示词",
      promptSectionHint: "注入模板 {{SKILLS}} 占位符的内容；开关关闭或模板无占位符时不注入。",
      promptLabel: "提示词",
      promptPlaceholders: [
        ["{{SKILL_METADATA}}", "已安装技能的元数据行（每技能一行「- 名称 — 描述」；无技能时为空）"],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  chat: {
    newSessionMenu: "新建对话",
    chooseAgent: "选择 Agent",
    chooseModel: "选择模型",
    thinkingLevel: "思考等级",
    /** Tier names for every surface that DISPLAYS an already-chosen level — the composer picker's trigger and tooltip, the mid-chat switch dialog and its toasts, the Project chat-defaults control and its read-only row. Chinese only, no wire value (per maintainer request): once the tier is picked, the English spelling is noise on a control this narrow, and it reads badly inside the 「…」 of the switch prose. `none` exists purely to display a stored legacy value — it is never offered as a choice (many models cannot disable thinking). */
    thinkingLevelNames: {
      none: "无",
      low: "低",
      medium: "中",
      high: "高",
      xhigh: "极高",
      max: "最高",
    } as Readonly<Record<string, string>>,
    /** Dropdown-row variant of the name above: choosing is where the wire value earns its place, so a menu row annotates the Chinese name with the value the pick will send. Only the composer's own dropdown uses it — a native `<select>` renders the picked option's text on the collapsed control too, which would put the annotation straight back onto a trigger. */
    thinkingLevelMenuName: (name: string, level: string): string => `${name} (${level})`,
    /** Mid-chat switch guard (issue #310): confirm before a level change that costs prompt-cache hits over the existing history. Title is the dialog's accessible name only. */
    thinkingSwitchTitle: "切换思考等级",
    thinkingSwitchBody: (to: string): string =>
      `将思考等级切换为「${to}」？会话中途切换会降低提示词缓存命中率、增加成本，先压缩上下文再切换更省。`,
    /** Shown under the body when the session isn't idle — compaction can only start on an idle session. */
    thinkingSwitchBusyHint: "会话正在运行，压缩要等空闲后才能开始。",
    /** Primary (recommended) choice: compact first, then apply the switch. */
    thinkingSwitchCompactFirst: "压缩后切换",
    thinkingSwitchConfirm: "仍要切换",
    /** Toast when the compaction starts: the switch is applied once it ends. */
    thinkingSwitchCompacting: "正在压缩上下文，压缩结束后切换思考等级。",
    thinkingSwitchApplied: (to: string): string => `上下文已压缩，思考等级已切换为「${to}」。`,
    /** Compaction ended without completing — the switch still applies, so say both. */
    thinkingSwitchCompactFailed: "压缩未成功完成，思考等级已照常切换。",
    workspaceUseThis: "使用此目录",
    workspaceUp: "上级目录",
    workspaceNoSubdirs: "无子目录",
    workspaceAuto: "临时工作区",
    workspaceClear: "改用临时工作区",
    workspaceDirInvalid: "目录不存在或无法访问，已回退",
    /** Grouping toggle of the sidebar conversation list (workspace grouping is the default) and the workspace groups. */
    groupByWorkspace: "按工作区分组",
    groupByAgent: "按 Agent 分组",
    groupByTime: "按时间分组",
    /** Time-mode bucket names (last day / last month / older), by last activity. */
    timeGroups: {
      day: "近一天",
      month: "近一月",
      earlier: "更早",
    },
    /** Session-list section header controls: search / list settings / mode-dependent create (具体新建的对象按分组方式决定). */
    searchSessions: "搜索会话",
    searchSessionsPlaceholder: "搜索会话…",
    searchClear: "清除搜索",
    /** Zero hits: the filter only sees already-loaded conversations, so the copy says so rather than claiming none exist. */
    searchNoMatches: "已加载的会话中无匹配",
    listSettings: "列表选项",
    groupModeSection: "分组方式",
    sortModeSection: "排序方式",
    sortManual: "手动排序",
    sortRecent: "最近更新",
    newWorkspaceEntity: "新建工作区",
    /** Registry-backed workspace group's overflow (… right of the header "+"): alias rename + sidebar-only removal. */
    workspaceMenu: "工作区选项",
    renameWorkspace: "重命名工作区",
    renameWorkspaceLabel: "名称",
    renameWorkspaceHint: "留空则使用目录名",
    deleteWorkspace: "删除工作区",
    deleteWorkspaceConfirm: (name: string) =>
      `确定移除「${name}」？仅从侧边栏移除该工作区分组，不影响磁盘目录与已有会话，可随时重新添加。`,
    tempWorkspaces: "临时工作区",
    newSessionInWorkspace: "在此工作区新建对话",
    draftSubtitle: "最擅长 AI 开发任务的自进化 Agent",
    /** Collapsed group names for the home-page examples (bookmark style; only one open at a time). */
    exampleFolders: {
      webapps: "搭建网页应用",
      agents: "搭建和优化智能体",
      schedules: "创建定时任务",
    },
    /** Second tooltip line on an example row: the click fills the composer, it does not send. */
    exampleFillHint: "点击填入输入框，可修改后自行发送",
    /** The examples block's last folder: prompts the user wrote and saved, stored per user on the server. */
    shortcuts: {
      folder: "我的快捷指令",
      new: "新建快捷指令",
      /**
       * Tooltip on the new-shortcut row. Unconditional, and worded to hold either way: the
       * editor opens on whatever the composer holds, which is a blank draft when it holds
       * nothing — saving what was just typed is the path this folder exists to shorten.
       */
      newFromComposer: "以输入框中的内容作为起点",
      createTitle: "新建快捷指令",
      editTitle: "编辑快捷指令",
      titleLabel: "名称",
      titleHint: (max: number) => `最多 ${max} 个字符`,
      promptLabel: "提示词",
      promptHint: (max: number) => `最多 ${max} 个字符`,
      /** Semantics behind the prompt field's "?": what the saved text does when clicked. */
      promptInfo:
        "点击这条快捷指令时，这段文字会原样填入输入框，不会自动发送；需要的 Skill 仍在输入框里自行勾选。",
      titleTooLong: (max: number) => `名称最多 ${max} 个字符`,
      promptTooLong: (max: number) => `提示词最多 ${max} 个字符`,
      deleteTitle: "删除快捷指令",
      deleteConfirm: (title: string) => `确定删除「${title}」？该快捷指令会从你的所有设备上消失。`,
    },
    /**
     * Example task cards on the draft screen: one click fills the composer with the canned
     * prompt, which the user reads, edits and sends. That is why a prompt is SHORT — a short
     * paragraph, around 100 Chinese characters, carrying what to build plus the constraints the
     * result would be wrong without. File layouts, field lists, step-by-step headings and
     * self-test instructions are what the Agent works out or asks about, so they stay out; the
     * older briefs below are still far longer and are being trimmed to match.
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
      rhythmRunner: {
        label: "音乐节奏跑酷小游戏",
        desc: "喵斯快跑式的音乐节奏跑酷：企鹅主角，音符踩着节拍飞来，判定分 Perfect / Great / Miss",
        prompt:
          "做一个喵斯快跑（Muse Dash）式的音乐节奏跑酷小游戏：主角是一只企鹅，自动向前跑；" +
          "音符画成音符图标，严格踩着节拍飞来，玩家按键击打，判定显示 Perfect / Great / Miss 三档，" +
          "连击计分，难度随曲子推进。纯前端单文件，file:// 直接打开即玩。",
      },
      investmentCopilot: {
        label: "对话式投资分析助理",
        desc: "用 Penguin SDK 做对话式看盘 Copilot：首页列出近期走势较好的股票，每个判断都说清市场因素",
        prompt:
          "用 Penguin SDK 做一个对话式的股市 Copilot，形态参考 perplexity.ai/finance：启动后每 5 分钟实时抓取大盘行情，" +
          "首页直接列出近期走势较好的股票和板块强弱，每个判断都要说清背后的市场因素——政策、行业消息、" +
          "资金流向、财报或宏观数据，而不是技术指标，" +
          "只做分析不是投资建议。它的查股工具要能答「帮我查一下智谱的股票」这类问题：" +
          "按公司名（中文也行）自己对应到股票代码，查不到或没上市就直说，不要编。",
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
        prompt: `请依次使用 \`agent-initialization\` 和 \`benchmark-design\`，创建决策 Agent，并产出 Frozen Benchmark 与 Formal Baseline。

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
      dailyPlan: {
        label: "每天早 9 点的计划对话",
        desc: "每天 09:00 在同一个会话里聊当天计划，并回顾昨天的进展",
        prompt:
          "建一个定时任务：每天早上 9 点在这个会话里和我聊今天的计划。" +
          "先回看上文说清昨天定的事做完了多少、哪些卡住，再给我一份排好序的今日候选、每条一句理由，" +
          "我确认后写成清单。",
      },
      githubDigest: {
        label: "每天汇总 GitHub 项目状态",
        desc: "定时跑一遍仓库的 Issue、PR 与 CI，日报结尾给出按优先级排序的建议",
        prompt:
          "建一个定时任务：每天早上用 gh 汇总一个 GitHub 仓库的 Issue、PR 与 CI 状态，" +
          "挑出停滞的、待评审的和挂掉的，结尾给出按优先级排序的建议，每条说清为什么排在这个位置。",
      },
      memoryReview: {
        label: "每周五晚回顾并记录 Memory",
        desc: "周五傍晚一起过一遍这周值得长期记住的事，确认后由你写进 Memory",
        prompt:
          "建一个定时任务：每周五傍晚在这个会话里和我过一遍这周值得长期记住的事。" +
          "先看已有记忆索引避免重复，再逐条问我该记什么、要不要改已有的，我确认后你写进 Memory。",
      },
    },
    sessionList: "Session",
    defaultSessionTitle: "新对话",
    agent: "Agent",
    model: "Model",
    workspace: "Workspace",
    workspaceHint: "留空自动创建临时工作区；指定时必须是服务器上已存在的目录",
    /** The same rule as `workspaceHint`, short enough to sit under a form field. */
    workspaceHintShort: "留空自动创建临时工作区",
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
    /** Settled Session that finished since the user last opened it (the unread dot; a Session already read shows no glyph, so it needs no label). */
    statusCompletedUnread: "运行完毕，未读",
    pendingApprovals: (n: number) => `${n} 个待审批`,
    jumpToLatest: "回到最新消息",
    /** Top-of-stream affordance while the previous history window is being fetched (scroll-up backfill). */
    loadingEarlier: "正在加载更早的对话…",
    /** Top-of-stream affordance after a backfill failure: click to retry fetching the previous window. */
    loadEarlierRetry: "更早的对话加载失败，点击重试",
    /** Top-of-stream marker once the loaded history reaches the very beginning (shown only after a backfill happened). */
    historyBeginning: "已是对话开头",
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
    /** One queued follow-up's hint line, with its content (per-entry variant of followUpQueuedChip). */
    followUpQueuedItem: (content: string) => `跟进消息已排队，本轮结束后自动发送：${content}`,
    /** Accessible name of the recall control on a queued steering / follow-up line — it is icon-only (a curved-back arrow), so this is what names it for screen readers (#287). */
    recallQueued: "撤回",
    /** Its tooltip: what the icon does, spelled out. */
    recallQueuedTitle: "撤回到输入框，编辑后重新发送",
    send: "发送",
    stop: "停止",
    compact: "压缩上下文",
    approve: "允许",
    deny: "拒绝",
    decisionAllow: "已批准",
    decisionDeny: "已拒绝",
    decisionManual: "手动",
    decisionAuto: "自动",
    decisionPolicy: "策略",
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
    /** Info-dropdown Session id row: the id itself is a click-to-copy button. */
    sessionIdLabel: "Session id",
    copySessionId: "复制 Session id",
    /** Info-dropdown trace row: labels the Session's trace file, shown as its NAME (clicking deep-links to the Trace page; the button beside it copies the full path). */
    traceFile: "轨迹文件",
    copyTracePath: "复制完整路径",
    /** Info-dropdown list of background processes the conversation started, and its per-row actions (Stop on running rows, Remove on exited ones). */
    processList: "会话进程",
    processStop: "停止",
    processExited: "已退出",
    processRemove: "移除",
    /** Remove button tooltip: removal also drops the output captured from that process. */
    processRemoveHint: "移除该条目——该进程已捕获的输出也会一并丢弃",
    /** Header chip title: count of the conversation's still-running background processes. */
    runningServices: (n: number) => `${n} 个运行中的服务`,
    statTokens: "Token 累计",
    /** Info-dropdown stats list: the tokens bullet's label and its cache-hit-rate parenthetical (rate = cacheRead ÷ all input, e.g. "68%"). */
    statTotalTokens: "总 Token",
    statCacheHit: (pct: string) => `缓存命中率 ${pct}`,
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
    openAgents: "智能体面板",
    workspacePanel: "工作区",
    /** File summary card at the end of a message (Codex-style): title, inline preview action, and collapsed row. */
    filesInMessage: (n: number) => `${n} 个文件`,
    imagesInMessage: (n: number) => `${n} 张图片`,
    openPreview: "点击预览",
    showMoreFiles: (n: number) => `显示其余 ${n} 个文件`,
    showLess: "收起",
    /** Memory-change card below the file summary and the Memory side panel: titles, scope/op tooltips, collapsed row. */
    memoryChangesTitle: (n: number) => `${n} 条记忆更新`,
    memoryScopeWorkspace: (key: string) => `工作区记忆（${key}）`,
    memoryOpWrite: "写入",
    memoryOpEdit: "编辑",
    memoryViewTitle: "记忆",
    memoryChangedMark: "本次对话已更改",
    memoryContentUnavailable: "无法加载内容（文件可能已被移动或删除）",
    memoryRowOpen: "查看内容",
    memoryBack: "返回列表",
    memoryEmptyAll: "还没有任何记忆——在对话里说「记住……」即可让 agent 保存",
    /** Visible label on the Memory panel's header link (not a tooltip-only glyph): says what the click does and where it lands. */
    openAgentMemory: "在 Agent 设置中管理",
    memoryShowMore: (n: number) => `显示其余 ${n} 条`,
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
    /** Toast when the session-state (locked) model display is clicked: points at the `/model` command. */
    modelLockedHint: "输入 /model 切换模型",
    scheduledFrom: (name: string) => `由定时任务「${name}」触发`,
    /** One-line notice of a `[background_task_done]` harness message (run_in_background completion): the collapsed row's whole label. */
    backgroundDone: (kind: "command" | "subagent", ok: boolean): string =>
      kind === "command"
        ? ok
          ? "后台命令完成"
          : "后台命令失败"
        : ok
          ? "后台任务完成"
          : "后台任务失败",
    emptyGreeting: "开始一段新对话",
    /** Unified step-row titles (same header idiom as workRunning/workDone). */
    mcpConnectTitle: "MCP 连接",
    mcpServerList: (servers: string[]): string => servers.join("、"),
    /** One-line result detail: tool count, plus the NAMES of failed servers (reasons live in the expanded server groups). */
    mcpConnectResult: (toolCount: number, failed: string[]): string => {
      const parts: string[] = [];
      if (toolCount > 0 || failed.length === 0) parts.push(`发现 ${toolCount} 个工具`);
      if (failed.length > 0) parts.push(`不可用：${failed.join("、")}`);
      return parts.join("；");
    },
    /** Per-server group row meta inside the expanded connect row. */
    mcpToolsCount: (n: number): string => `${n} 个工具`,
    mcpServerFailed: "连接失败",
    mcpConnectAborted: "已中断，下次发送时重新连接",
    /** The row title names the step by what it actually did, so a `discard` is never announced as compaction: it clears the context rather than compacting it. Naming the mode in the title leaves nothing for a success line to add, which is why there is no outcome string beside this one; a `summarize` row needs none either, since it shows its adopted summary in its own expandable body. Only `compactionFailed` remains, carrying the one thing a title cannot. */
    compactionTitle: (mode: string): string => (mode === "discard" ? "清空" : "压缩"),
    compactionFailed: (status: string, errorMessage?: string): string => {
      if (status === "aborted") return "已中断，保留当前上下文";
      return errorMessage !== undefined
        ? `失败（${errorMessage}），保留当前上下文`
        : "失败，保留当前上下文";
    },
    unknownTool: "（未知工具）",
    workRunning: "运行中",
    workDone: "运行完毕",
    workGroupSteps: (n: number) => `${n} 步`,
    approvalWaiting: "待审批",
    copyCode: "复制代码",
    copyReply: "复制回复",
    forkSession: "从这里分叉对话",
    forkSessionConfirmBody: "将把这段对话（截至这条回复）复制为一个新对话，原对话保持不变。",
    forkSessionConfirmAction: "分叉",
    forkSessionFailed: "无法定位这条回复，请刷新后重试。",
    copyMessage: "复制消息",
    deleteSession: "删除对话",
    renameSession: "重命名对话",
    renameSessionLabel: "标题",
    deleteSessionConfirm: (title: string) =>
      `确定删除「${title}」？该对话的消息与 Trace 将被移除，且不可恢复。`,
    /** Parked draft conversations (unsent new chats living in the sidebar list — see draft-sessions.ts). */
    draftGroup: "草稿",
    draftUntitled: "（无标题草稿）",
    deleteDraft: "删除草稿",
    deleteDraftConfirm: (title: string) => `确定删除草稿「${title}」？未发送的内容将被丢弃。`,
    archiveSession: "归档",
    unarchiveSession: "取消归档",
    /** Per-row ellipsis overflow menu (pin / rename / archive / delete live inside it) and the row-level pin. */
    pinSession: "置顶",
    unpinSession: "取消置顶",
    pinnedSession: "已置顶",
    /** Sidebar group "reveal/load next page" row (display cap + server paging). */
    loadMore: "更多",
    /** Time mode's whole-list paging row: its buckets span every Agent, so one row below them fetches the next page rather than each bucket claiming to. */
    loadMoreSessions: "加载更多会话",
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
    /**
     * Toast for a picked file rejected before reading. The limit is admin-settable and differs
     * between file attachments and inline images, so it is passed in rather than written here.
     */
    attachmentTooLarge: (name: string, limitMb: number): string =>
      `${name} 超过 ${limitMb}MB 上限，未添加。`,
    /** Overlay covering the chat area while files are dragged over it (drag-and-drop upload). */
    dropFilesTitle: "松开以添加附件",
    dropFilesDesc: "图片与文件将添加到输入框",
    /** Toast when non-image files are dropped in goal mode (the objective carries images only). */
    dropFilesGoalHint: "目标模式仅支持附加图片，文件未添加。",
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
    topologyLabel: "调用关系",
    mainSessionNote: "主会话请在对话区查看",
    empty: "本次任务尚未派生子智能体",
    nodeRunning: "运行中",
    nodeDone: "已完成",
    /** Identity-strip jump: opens the selected subagent's own Session in the chat area. */
    openAsSession: "跳转到该会话",
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
    rangeLabel: "日期范围",
    rangeHour: "最近一小时",
    rangeDay: "最近一天",
    range7d: "近 7 天",
    range30d: "近 30 天",
    range90d: "近 90 天",
    rangeCustom: "自定义",
    chartRequestsByAgent: "各 Agent 请求与成功率",
    chartRequestsByModel: "各模型请求与成功率",
    legendSuccessRate: "成功率",
    chartTokenTrend: "Token 变化",
    chartCostTrend: "成本变化",
    legendOther: (n: number): string => `其他 ${n} 项`,
    bucketTotal: "合计",
    legendHitRate: "缓存命中率",
    empty: "暂无用量记录",
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
    legendOther: "其他",
    toolParams: "参数 Schema",
    /** Spoken form of the red "*" in the schema table, where no control carries `aria-required`. */
    requiredParam: "必填",
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
    /** The round-card badge reuses `chat.compactionTitle`, which names the mode (压缩 / 清空), so the Trace page and the conversation cannot drift apart; there is deliberately no Trace-local copy of that word. */
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
      desktop_single_user: "桌面应用为单用户模式，用户管理不可用。",
      not_found: "资源不存在，或你没有访问权限。",
      internal: "服务器内部错误，请稍后重试。",
      agent_not_found: "该 Agent 已不存在。",
      unknown_agent: "该 Agent 不存在于本 Project。",
      agent_exists: "该 Agent id 已被占用。",
      agent_deleting: "该 Agent 正在删除中。",
      project_exists: "该 Project id 已被占用。",
      project_not_found: "该 Project 已不存在，或你没有访问权限。",
      cannot_delete_last_project: "这是最后一个 Project，不能删除。",
      user_exists: "该用户名已被占用。",
      user_not_found: "该用户已不存在。",
      cannot_delete_admin: "内置 admin 不可删除。",
      member_not_found: "该用户不是本 Project 的成员。",
      already_member: "该用户已是本 Project 的成员。",
      already_owner: "该用户已是本 Project 的所有者。",
      memory_import_confirm_required: "本次导入会覆盖或删除已有记忆，请确认后继续。",
      schedule_exists: "已存在同名定时任务。",
      schedule_not_found: "该定时任务已不存在。",
      unknown_skill: "该技能不在技能库中。",
      skill_too_large: "该技能目录过大，超出了导入限制。",
      file_not_found: "该文件已不存在。",
      not_pending: "该消息已发出，无法撤回。",
      file_too_large: "文件过大。",
      too_many_files: "一条消息附加的文件过多。",
      payload_too_large: "请求体过大。",
      image_too_large: "图片过大，无法随对话发送。",
      dir_not_absolute: "目录必须是绝对路径。",
      dir_not_found: "该目录不存在或不可访问。",
      not_a_dir: "该路径不是目录。",
      path_not_found: "该路径不存在。",
      workspace_missing: "该 Session 的 Workspace 已不存在。",
      workspace_not_found: "该 Workspace 不存在或不是目录。",
      session_not_found: "该 Session 已不存在，或你没有访问权限。",
      session_deleting: "该 Session 正在删除中。",
      approval_not_found: "该授权请求已处理或已失效。",
      process_not_found: "该后台进程已结束或已被移除。",
      process_running: "该后台进程仍在运行，请先结束再移除。",
      memory_file_not_found: "该记忆文件已不存在。",
      memory_scope_not_found: "该记忆范围已不存在。",
      task_in_progress: "该 Session 已有任务在运行。",
      compacting: "该 Session 正在压缩上下文，暂不接受新的输入。",
      shutting_down: "服务正在关闭，请稍后重试。",
      // The three "cannot compact" reasons each have their own server code, so each keeps its
      // own explanation here — collapsing them into one sentence would tell a user who just
      // compacted that they have never spoken.
      compaction_not_configured: "该 Agent 没有配置上下文压缩。",
      nothing_to_compact: "当前上下文还没有可压缩的内容（尚未完成一轮对话）。",
      already_compacted: "刚刚压缩过，之后还没有新的对话，无需重复压缩。",
      version_conflict: "快照版本不高于当前版本。",
      invalid_title: "标题无效。",
      invalid_proxy_url: "代理地址无效：应为 http(s):// 或 socks5:// 代理 URL，或 主机[:端口]。",
      invalid_attachment_limit: "上传限制无效：请填写允许范围内的整数 MB，且合计不低于单个上限。",
      invalid_trace: "该文件不是有效的 Trace 文件。",
      trace_not_found: "该 Trace 文件已不存在。",
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
