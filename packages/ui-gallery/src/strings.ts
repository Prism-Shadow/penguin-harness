/**
 * Gallery chrome copy (bilingual): this file holds the Chinese dictionary `zh` and the
 * `GalleryStrings` shape; the English dictionary lives in strings-en.ts. These strings are the
 * gallery's own and never reach the product. Theme display names are per language (通用 / 白领 /
 * 极客 here, Primer / Frost / Console in English) and so are breadcrumbs; theme ids, token names,
 * accent preset ids and font names stay English in both.
 *
 * `surfaces` names the app's surfaces the gallery frames (src/app/surfaces.ts) in both
 * dictionaries; `catalog` translates the Foundations module's titles and its sections'. English
 * reads the module file directly, so only `zh` fills `catalog`; a test checks it covers every
 * module, variant and section.
 */
import type { HookName, ThemeId, ToneName } from "@prismshadow/penguin-ui";
import type { TextSize } from "@prismshadow/penguin-ui/boot";
import type { ModuleId } from "../../ui/src/module";
import type { SurfaceGroupId, SurfaceId } from "./app/surfaces";

/** What a surface page says: its title, one line on what the frame shows, and how the app reaches it. */
export interface SurfaceCopy {
  title: string;
  description: string;
  /** Where the surface sits in the app, for a reader who wants to find it themselves. */
  how: string;
}

export const zh = {
  brand: {
    title: "Penguin UI",
  },
  /** The top bar's page links, the left nav, the "on this page" list and the phone drawer. */
  site: {
    home: "首页",
    surfaces: "界面",
    foundations: "基础",
    fonts: "字体",
    pages: "页面",
    search: "搜索界面",
    searchShortcut: "Ctrl K",
    noMatches: "没有匹配的界面。",
    nav: "界面列表",
    onThisPage: "本页目录",
    settings: "显示设置",
    menu: "打开菜单",
    closeMenu: "关闭菜单",
    notFound: (id: string) => `没有名为「${id}」的页面。`,
    allSurfaces: "全部界面",
    feedbackTitle: "反馈",
    feedbackBody: "引用预览工具条末尾的路径，或用链接按钮复制这一页的地址。",
    feedbackExample: "白领 › 对话 · 深色",
  },
  /** The surface groups (src/app/surfaces.ts): the index's headings, the nav's eyebrows, a page's eyebrow. */
  surfaceGroups: {
    conversation: "对话",
    workbench: "工作台",
    resources: "资源",
    measure: "度量",
    system: "系统",
  } as Record<SurfaceGroupId, string>,
  surfaces: {
    chat: {
      title: "对话",
      description:
        "一次完成的任务：思考、三次工具调用、一处差异、一段带表格与代码的 Markdown 回答。",
      how: "侧栏 › 会话列表中的任意一行。",
    },
    "chat-running": {
      title: "对话 · 工具运行中",
      description: "任务进行中：一条命令正在执行，工具行显示运行状态与计时。",
      how: "侧栏 › 带运行标记的会话行。",
    },
    "chat-thinking": {
      title: "对话 · 思考中",
      description: "任务进行中：模型正在思考，思考行显示运行状态，文字仍在增长。",
      how: "侧栏 › 带运行标记的会话行。",
    },
    "chat-approval": {
      title: "对话 · 待审批",
      description: "任务等待人工：一条命令需要批准，允许或拒绝之后任务继续并结束。",
      how: "侧栏 › 带审批标记的会话行。",
    },
    "chat-new": {
      title: "新对话",
      description: "草稿页：选择智能体、工作区、审批模式与模型，输入并发送第一条消息。",
      how: "侧栏 › 新对话。",
    },
    agents: {
      title: "智能体",
      description: "智能体列表：每个智能体的活动曲线、会话数、工具、Skill 与定时任务计数。",
      how: "侧栏 › 智能体。",
    },
    "agent-settings": {
      title: "智能体设置",
      description:
        "一个智能体的设置页：概览、提示词、记忆、运行时、工具、Skill、钩子、Vault 与定时任务标签页。",
      how: "智能体 › 任意一个智能体。",
    },
    schedules: {
      title: "定时任务",
      description: "智能体设置的定时任务标签页：周期、下次触发、绑定的会话与模型。",
      how: "智能体 › 智能体设置 › 定时任务标签页。",
    },
    plugins: {
      title: "插件市场",
      description: "插件库按分类列出，带搜索与筛选；已安装的 Skill 与钩子按智能体显示。",
      how: "侧栏 › 插件市场。",
    },
    "plugin-detail": {
      title: "插件详情",
      description: "一个插件的详情页：说明、它带来的 Skill、文件浏览器与安装入口。",
      how: "插件市场 › 任意一个插件。",
    },
    models: {
      title: "模型库",
      description: "按供应商分组的模型表：默认模型、凭据、价格、上下文窗口与用量。",
      how: "侧栏 › 模型库。",
    },
    machines: {
      title: "机器",
      description: "本机与远程机器：安装状态、连接、探测结果，以及添加 ssh 主机。",
      how: "侧栏 › 机器（仅管理员）。",
    },
    usage: {
      title: "成本中心",
      description:
        "三十天的用量：Token、花费、请求数与成功率，按日期、智能体、模型或会话分组，附错误面板。",
      how: "侧栏 › 成本中心。",
    },
    benchmark: {
      title: "评估中心",
      description: "评估任务列表：已发布与草稿状态、用例数、历次评估的分数走势。",
      how: "侧栏 › 评估中心。",
    },
    "benchmark-detail": {
      title: "评估详情",
      description: "一个评估任务：分数曲线、每轮评估的用例得分、用例的题面与评分标准文件。",
      how: "评估中心 › 任意一个评估任务。",
    },
    settings: {
      title: "设置",
      description:
        "设置对话框：个人资料、通用、外观（主题、明暗、强调色、字号、字体）、账户，以及服务器设置。",
      how: "侧栏底部的账户菜单 › 设置。",
    },
    "settings-appearance": {
      title: "外观设置",
      description:
        "设置对话框停在「外观」页：主题、明暗、强调色、五档字号与字体组合——主题切换就在这里。",
      how: "侧栏底部的账户菜单 › 设置 › 外观。",
    },
    login: {
      title: "登录",
      description: "登录页：装饰画布上的登录卡片。任意密码即可登录演示账户。",
      how: "未登录时的任意地址。",
    },
  } as Record<SurfaceId, SurfaceCopy>,
  home: {
    eyebrow: "界面画廊",
    title: "Penguin UI",
    lead: "真实的 Web App，在三套主题、两种明暗、五档字号、可选字体组合与两种语言下运行——数据来自浏览器内的演示接口，可以随意点击。",
    app: "应用",
    appLead:
      "这就是应用本身：侧栏、各个中心、对话与设置都能点开。主题与字号等控件作用于框内的应用；发送消息会得到一段脚本回复。",
    index: "界面索引",
    indexLead: "每个界面一页：应用停在该界面上，可在三套主题下对比。",
    foundations: "基础与字体",
    foundationsLead: "令牌词汇表的各个面板，以及打包的字体、字样与许可。",
  },
  /**
   * The view controls' copy, in the top bar; the key keeps the name of the rail that held them,
   * which the Foundations boards read (`S.rail.langNames`).
   */
  rail: {
    theme: "主题",
    themeNames: { github: "通用", modern: "白领", geek: "极客" } as Record<ThemeId, string>,
    mode: "明暗",
    accent: "强调色",
    accentTheme: "随主题",
    size: "字号",
    sizeNames: { xs: "特小", s: "小", m: "中", l: "大", xl: "特大" } as Record<TextSize, string>,
    sizeTitle: (name: string, px: number) => `${name} · 根字号 ${px}px`,
    fontLatin: "英文字体",
    fontCjk: "中文字体",
    fontTheme: "随主题",
    fontSystem: "系统",
    language: "语言",
    viewport: "视口",
    viewports: { desktop: "桌面", phone: "手机" },
    langNames: { en: "EN", zh: "中文" },
    modes: { light: "浅色", dark: "深色", system: "跟随系统" },
    compare: "三主题对比",
  },
  /** The current fonts, read from the framed app: the role labels before each family. */
  readout: {
    label: "当前字体",
    latin: "英文",
    cjk: "中文",
    mono: "等宽",
    pending: "读取中…",
  },
  /** The breadcrumb's own words; everything else in it is a name from elsewhere. */
  crumb: {
    modes: { light: "浅色", dark: "深色" },
    phone: "手机",
  },
  intro: {
    resolving: "正在解析令牌…",
    problems: "模块与演示的问题",
  },
  /** A framed app's toolbar and captions. */
  frame: {
    open: "单独打开",
    reload: "重新载入",
    compare: "三主题对比",
    compareOn: "退出对比",
    frameOf: (theme: string) => `${theme} 下的应用`,
    how: "在应用里的位置",
    route: "路由",
    signedOut: "未登录",
  },
  section: {
    copyLink: "复制链接",
    copied: "已复制",
    copyBreadcrumb: "复制路径",
    parts: "组件",
    tokens: "令牌",
    source: "源码",
    variants: "变体",
    tokensIn: (where: string, count: number) => `${where} 下读取的 ${count} 个令牌`,
    noTokens: "这个面板没有读取任何令牌。",
    unset: "未定义",
    loadingCode: "正在加载源码…",
    partsOf: (count: number) => `${count} 个组件`,
    noParts: "这个模块不列出组件。",
    replaces: (what: string) => `替代 ${what}`,
  },
  foundations: {
    surfaces: "表面",
    inks: "文字",
    lines: "线条",
    inkWords: ["正文", "次要", "弱化"] as readonly string[],
    accent: "强调色",
    presetsHint: "主题自带的强调色，与当前主题列出的五个预设；别的主题的预设在这里不生效",
    themeAccent: "主题",
    sampleSend: "发送",
    selectedRow: "选中",
    sampleLink: "打开文档",
    linkHover: "悬停",
    tones: "语义色调",
    toneWords: {
      success: "运行中",
      attention: "等待中",
      danger: "失败",
      done: "已完成",
      neutral: "空闲",
      info: "同步中",
    } as Record<ToneName, string>,
    charts: "图表序列",
    tokenSeries: "Token 构成",
    code: "代码与差异",
    codeLines: {
      before: "const hits = rank(q).slice(0, ",
      removed: "3",
      added: "6",
      after: ");",
      selected: "return cite(hits);",
    },
    typeNote: "每一行都用各自角色的令牌排版；中文列显示主题字体如何排中文与夹在其中的拉丁文字。",
    scene: {
      pageTier: "页面",
      cardTitle: "Docs Expert",
      cardMeta: "3 个会话 · $0.0231",
      nested: "内层方框的圆角 = 外层圆角 − 内边距",
      primary: "保存",
      secondary: "取消",
      input: "搜索会话",
      badge: "运行中",
      menuTier: "z-[60] 菜单",
      menuItems: ["置顶", "重命名", "移动到…"] as readonly string[],
      backdropTier: "z-50 对话框",
      dialogTitle: "删除这个会话？",
      dialogBody: "对话记录与 Trace 文件会一并删除。",
      cancel: "取消",
      confirm: "删除",
      toastTier: "z-[100] 通知",
      toast: "已导出 Trace #001",
    },
    radius: "圆角",
    shadows: "阴影层级",
    spacingPage: {
      title: "设置",
      appearance: "外观",
      theme: "主题",
      themeOptions: ["浅色", "深色", "跟随系统"] as readonly string[],
      fontSize: "字号",
      sizeOptions: ["特小", "小", "中", "大", "特大"] as readonly string[],
      general: "通用",
      language: "语言",
      languageOptions: ["中文", "English"] as readonly string[],
      notifications: "完成时通知",
    },
    stack0Note: "stack-0：图标与文字之间的窄条",
    controlHeights: "控件高度（实测）",
    iconSizes: "图标尺寸",
    iconRegistry: (icons: number, files: number) => `${icons} 个图标，来自 ${files} 个文件`,
    duplicateNames: "同一路径的多个名字",
    durations: "时长 × 缓动",
    reducedNote: "已减弱动效：每个变化直接呈现终态。",
    liveSignal: "实时信号",
    loading: "加载中",
    focusRing: "焦点环",
    inputFocus: "输入框焦点",
    selection: "选区",
    scrollbar: "滚动条",
    spaceUnit: "间距单位",
    spaceUnitNote: "所有间距与尺寸工具类都是它的倍数：h-8 即八个单位。",
    shell: "外壳",
    shellNote: "经 .ui-shell 的应用窗口：底场、导航列与主列，各主题自行决定它们的关系。",
    presence: "进出",
    presenceNote: "菜单自上方、对话框自中心、通知自下方进出，各按当前主题的进出令牌。",
    reveal: "显现",
    revealNote: "流式文本逐块显现，每一块只在出现时按显现令牌动一次。",
    layout: "布局",
    layoutNote: "侧栏在展开与图标栏之间的宽度变化，按布局令牌。",
    replay: "重放",
    replayAll: "全部重放",
    motionSpecimens: {
      menu: "菜单",
      dialog: "对话框",
      toast: "通知",
      trigger: "更多",
      sidebarRows: ["新对话", "智能体", "模型库"] as readonly string[],
    },
    hookJobs: {
      "ui-glass": "盖在内容之上的临时层",
      "ui-eyebrow": "为下方一组条目命名的分组标签",
      "ui-display": "页面或主视觉唯一的展示标题",
      "ui-live": "正在进行之物的动效",
      "ui-frame": "带头部、主体、底部与窗格的细线框",
      "ui-underline-nav": "标签栏中选中项的标记",
      "ui-shell": "应用窗口：导航列与主列",
      "ui-icon-decor": "标签已经说明了的图标：主题可以着色或不画",
      "ui-tree": "行会嵌套的列表：文件树、工作组的工具行、子 Agent 调用图",
      "ui-field": "带标签的控件行：表单字段或设置行",
      "ui-activity": "正在工作的思考行或工具行：运行中、已完成或出错",
    } as Record<HookName, string>,
    hookSamples: {
      menu: ["置顶", "重命名", "删除"] as readonly string[],
      group: "工作区",
      rows: ["claude-code-expert", "docs-sync", "release-notes"] as readonly string[],
      copy: "复制",
      tabs: ["概览", "轨迹", "文件"] as readonly string[],
      streaming: "正在写回答",
      tree: {
        root: "claude-code-expert",
        dir: "src",
        files: ["rag.ts", "embed.ts"] as readonly string[],
        last: "README.md",
      },
      field: {
        name: "名称",
        value: "Docs Expert",
        hint: "在侧栏与消息中显示的名字。",
        notify: "完成时通知",
        notifyHint: "Task 结束时弹出系统通知。",
      },
    },
  },
  fonts: {
    title: "字体与许可",
    specimens: "字样",
    specimensHint: "每个主题的字体族，在五档字号（14 / 15 / 16 / 18 / 20 px）下各排一段中英文。",
    declared: "已声明的字体",
    declaredHint:
      "页面样式表中的 @font-face，按字体族、字重与样式合并；只有文本用到某个分片时浏览器才会下载它。",
    noFaces: "尚未声明任何字体。",
    family: "字体族",
    weight: "字重",
    slicesColumn: "分片",
    loadStatus: "加载情况",
    licences: "许可文本",
    noLicences: "还没有许可文本。",
    status: { loaded: "已加载", unloaded: "未使用", loading: "加载中", error: "失败" },
  },
  catalog: {
    modules: {
      foundations: {
        title: "基础",
        description:
          "调色板、字号梯度、形状与层次、节奏间距、图标、动效、焦点与十个样式钩子，每项一块面板。",
        variants: {
          colour: "颜色",
          type: "排版",
          "shape-depth": "形状与层次",
          spacing: "间距",
          icons: "图标",
          motion: "动效",
          focus: "焦点",
          hooks: "样式钩子",
        },
      },
    } as Partial<
      Record<ModuleId, { title: string; description: string; variants: Record<string, string> }>
    >,
    sections: {
      "icons-glyph-icon": { description: "唯一的线形图标渲染器，描边读取 --ui-icon-stroke。" },
      "icons-registry": { title: "图标表", description: "所有路径字符串，按组归档，只声明一次。" },
      "icons-marks": { title: "标记", description: "与线形图标并存的非网格标记。" },
    } as Partial<Record<string, { title?: string; description: string }>>,
  },
};

export type GalleryStrings = typeof zh;
