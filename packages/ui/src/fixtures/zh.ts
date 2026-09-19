/**
 * The Chinese dataset: the same structure as `en.ts`, built by the same `buildFixtures`, with
 * prose from the web app's zh dictionary (`strings.ts`) and the landing page's zh capture script.
 */
import { buildFixtures } from "./dataset";
import type { Fixtures } from "./types";

export const zh: Fixtures = buildFixtures("zh", {
  copy: {
    appName: "PenguinHarness",
    nav: {
      newChat: "新对话",
      agents: "智能体",
      plugins: "插件库",
      models: "模型库",
      usage: "成本中心",
      benchmark: "评估中心",
      traces: "轨迹观测",
      files: "文件",
      sessions: "Session",
      collapseSidebar: "收起侧栏",
      search: "搜索会话",
      filterSessions: "筛选与排序",
      newFolder: "新建文件夹",
    },
    chat: {
      runStates: {
        running: "运行中",
        waiting: "待审批",
        done: "运行完毕",
        failed: "失败",
        stopped: "已停止",
      },
      running: "运行中",
      done: "运行完毕",
      attach: "添加附件",
      steps: (n) => `${n} 步`,
      thinking: "思考",
      approvalWaiting: "待审批",
      decisionAllow: "已批准",
      decisionAuto: "自动",
      sendToBackground: "转入后台执行",
      subagent: "子会话",
      toolAliases: {
        read_file: "读取",
        write_file: "写入",
        edit_file: "编辑",
        exec_command: "执行命令",
        input_command: "跟进命令",
        run_subagent: "子智能体",
        input_subagent: "交流",
      },
      backgroundCall: "[后台任务]",
      inputPlaceholder: "输入消息，Enter 发送，Shift+Enter 换行，可粘贴图片",
      slashHint: "输入 / 使用命令",
      approvalModes: {
        "allow-all": "全部放行",
        "read-only": "放行只读",
        "deny-all": "全部拒绝",
        "always-ask": "总是询问",
      },
      thinkingLevels: { low: "低", medium: "中", high: "高" },
      skills: "技能",
      stop: "停止",
      copy: "复制消息",
      fork: "从这里分叉对话",
      approve: "允许",
      deny: "拒绝",
    },
    dock: {
      subagents: (n) => `子智能体（${n}）`,
      topology: "调用关系",
      nodeRunning: "运行中",
      nodeDone: "已完成",
      openAsSession: "跳转到该会话",
      newPanel: "添加面板",
      movePanel: "移到另一侧",
      bottomDock: "底部面板",
      rightDock: "右侧面板",
      close: "关闭",
    },
    traces: {
      filesTitle: "Trace 文件",
      export: "导出",
      overall: "全局统计",
      turns: "轮次",
      toolCalls: "工具调用",
      compactions: "压缩次数",
      inputTokens: "输入 tokens",
      cacheHits: "命中缓存",
      outputTokens: "输出 tokens",
      cost: "成本",
      elapsed: "用时",
      outputTps: "输出 TPS",
      turn: (n) => `第 ${n} 轮`,
      timeline: "执行时间线",
      modelLane: "模型",
      legend: {
        thinking: "思考",
        text: "模型回复",
        toolgen: "工具调用生成",
        approvalWait: "审批等待",
        exec: "工具调用执行",
        other: "其他",
      },
      zoom: "缩放",
      messages: "消息",
      fromSubagent: "子会话",
    },
    settings: {
      title: "设置",
      groupPersonal: "个人",
      groupServer: "服务器",
      pages: {
        profile: "个人资料",
        general: "通用",
        appearance: "外观",
        account: "账户",
        proxy: "代理选项",
        uploads: "上传限制",
        company: "公司模式",
        users: "用户管理",
      },
      theme: "主题",
      themeInfo: "应用的明暗外观。",
      light: "浅色",
      dark: "深色",
      system: "跟随系统",
      terminalTheme: "终端主题",
      terminalThemeInfo: "终端面板的配色，默认跟随应用主题。",
      followApp: "跟随主题",
      fontSize: "字号",
      fontSizeInfo: "界面整体字号。",
      fontSizes: { sm: "小", md: "中", lg: "大" },
      accent: "主题色",
      accentInfo: "界面强调色。",
      launcher: "快捷方式悬浮球",
      launcherInfo: "在对话正文右缘浮动的圆形按钮，展开后是工作台各块面板与终端的快捷方式。",
      toolAliases: "工具短名",
      toolAliasesInfo: "对话里的工具卡片用短名称呼内置工具，read_file 显示为「读取」。",
      moreInfo: "说明",
      close: "关闭",
    },
    auth: {
      username: "用户名",
      password: "密码",
      signIn: "登录",
      showPassword: "显示密码",
      defaultAdminNote:
        "首次使用请打开服务端启动输出中的首次登录链接，认领内置管理员 admin 并设置密码。这里没有可输入的初始密码",
      forgotAdminNote:
        "忘记管理员密码时，停止服务后执行 penguin server reset-admin-password 重置为新的初始密码",
      language: "语言",
      langZh: "中文",
      langEn: "English",
    },
  },
  userName: "alex",
  agents: {
    default: {
      name: "Penguin",
      description: "每个 Project 自带的通用智能体",
    },
    reviewer: {
      name: "文档审阅员",
      description: "阅读渲染后的文档，报告失效链接和错误引用",
    },
  },
  session: {
    title: "构建 Claude Code 文档专家",
    turn1: {
      prompt:
        "收集 https://github.com/ericbuess/claude-code-docs 的文档，做一个化身 Claude Code 配置专家、回答带来源引用的 RAG 问答应用。",
      thinking1:
        "一句话需求，**penguin-sdk** 技能给出了完整配方：先采集语料，再建 BM25 索引，回答经 Session 流式生成并带 `[n]` 引用直达原文。",
      text1: "先把文档采集进语料库：",
      collectDescription: "克隆文档，只保留 Markdown",
      thinking2:
        "语料就绪。写应用：本地 BM25 检索（零 embedding 依赖）+ 引用回答 + Penguin 风格聊天界面，引用链接到 `/corpus` 原文。",
      text2: "语料就绪，写检索与引用回答的应用入口：",
      appDescription: "编写 BM25 检索应用",
      answer: `Claude Code 文档专家已就绪：

{tree}

| 部分 | 作用 |
| --- | --- |
| 检索 | 本地 BM25 索引全部文档片段，中文提问同样支持 |
| 回答 | 每次提问经 Session 流式生成，引用 [1][2] 可点击直达 \`corpus/\` 原文 |
| 界面 | Penguin 风格聊天页，空态内置示例问题 |

运行 \`{run}\`，浏览器打开 {url}。`,
    },
    turn2: {
      prompt: "确保每个 [n] 引用都能打开 corpus/ 下真实存在的文件，为此加个测试并跑一遍。",
      thinking:
        "命中结果直接来自索引，建索引后被删掉的文件仍会被引用。要在命中结果进入提示词**之前**过滤，再加一个 `node:test` 测试文件，问两个问题：一个能命中，一个不可能命中。",
      editDescription: "丢弃源文件已不存在的命中结果",
      writeDescription: "新增引用测试",
      text: "引用已过滤。现在跑测试，同时请审阅员并行检查渲染：",
      thinking2: "测试走 API，审阅只读 HTML，两者互不依赖，可以同时进行。",
      reviewDescription: "检查 index.html 中引用的渲染",
      reviewPrompt:
        "阅读 claude-code-expert/public/index.html，确认流式回答里的每个 [n] 标记都会变成指向 /corpus 下源文件的链接，报告任何会渲染出失效链接的地方。",
      testDescription: "启动应用并运行引用测试",
      reviewThinking:
        "标记在浏览器端改写，所以关键就是 `linkify()` 如何处理 `sources`，以及 `sources` 何时到达。",
      reviewReadDescription: "阅读聊天页面",
      reviewReply:
        "`linkify()` 只在 `sources[n - 1]` 存在时才生成链接，超出来源数量的标记保持纯文本——这点没问题。有一处缺口：`sources` 在最后一段增量之后才到达，所以回答流式输出期间所有 `[n]` 都是纯文本，直到",
    },
    draft: "再加一条用中文提问的测试",
  },
  sidebar: {
    groupWorkspace: "claude-code-expert",
    groupEarlier: "近 7 天",
    now: "刚刚",
    rows: {
      tokenizer: { title: "修复不稳定的 BM25 分词测试", time: "2 小时前" },
      hooks: { title: "审阅 hooks.md 的引用", time: "5 小时前" },
      trace: { title: "第 3 轮为什么没命中缓存？", time: "昨天" },
      weekly: { title: "每周文档同步", time: "9月12日" },
      deploy: { title: "把应用打包成 Docker 镜像", time: "9月10日" },
    },
  },
  modelNotes: {
    "deepseek-v4-pro": "Project 默认 · 闲时折扣",
    "claude-opus-5": "支持图片 · 1M 上下文",
    "gpt-5.6-luna": "支持图片的最低价",
  },
  notesFileName: "笔记.md",
  company: {
    orgName: "文档专家公司",
    mission: "让 Claude Code 文档专家对每个问题都回答准确、引用可查、响应迅速。",
    employees: {
      ceo: { name: "安达", title: "首席执行官" },
      eng: { name: "陈睿", title: "检索工程师" },
      docs: { name: "米娜", title: "文档策展" },
      qa: { name: "西奥", title: "质量负责人" },
      ops: { name: "索尔", title: "发布运维" },
    },
    tickets: {
      citations: { title: "每个 [n] 引用都必须打开真实的语料文件" },
      tokenizer: { title: "修复不稳定的 BM25 分词测试" },
      zhQueries: { title: "支持中文提问" },
      deploy: {
        title: "把应用打包成 Docker 镜像",
        blocked: "等待引用修复合入",
      },
      evalSet: { title: "建立 50 题评估集" },
      cache: { title: "保持系统提示词缓存稳定" },
      pdf: { title: "导入 PDF 版发布说明" },
      readme: { title: "README 增加快速上手一节" },
    },
    events: {
      standup: {
        title: "每日站会",
        prompt: "阅读昨天的工单变更，在群聊里发三行摘要。",
      },
      triage: {
        title: "工单分拣",
        prompt: "按优先级整理新工单，并为每张指定负责人。",
      },
      review: {
        title: "代码评审",
        prompt: "评审「评审中」一列的每张工单，推进或退回。",
      },
      evalRun: {
        title: "评估运行",
        prompt: "运行 50 题评估集，把分数附到对应工单上。",
      },
      retro: {
        title: "每周复盘",
        prompt: "写下做得好的、做得不好的，以及下周要尝试的一项改变。",
      },
      report: {
        title: "支出报告",
        prompt: "按员工发布本周支出与预算的对比。",
      },
    },
  },
  notices: {
    byTone: {
      success: { title: "Trace 已导出", body: "已写入 trace-001.jsonl，共 48.2 KB。" },
      attention: {
        title: "有命令等待审批",
        body: "exec · 启动应用并运行引用测试。",
        action: "去查看",
      },
      danger: {
        title: "无法连接模型提供方",
        body: "DeepSeek 连续两次返回 503，本轮在第二次重试后停止。",
        action: "重试",
      },
      done: { title: "第 1 轮已完成", body: "7 次工具调用，43.8k tokens，$0.0231。" },
      neutral: {
        title: "工具短名已开启",
        body: "工具卡片显示「读取」「写入」「执行命令」，Trace 仍保留完整名称。",
      },
      info: {
        title: "有新版本可用",
        body: "0.2.14 为成本中心加入了按模型的明细。",
        action: "查看更新内容",
      },
    },
    toasts: [
      { tone: "success", title: "已添加模型", body: "DeepSeek V4 Flash 可以使用了。" },
      {
        tone: "danger",
        title: "密钥保存失败",
        body: "提供方拒绝了它：401。",
        action: "重试",
      },
    ],
  },
  forms: {
    title: "添加模型提供方",
    description: "该提供方的模型会加入所有 Project 的模型库。",
    fields: [
      {
        name: "provider",
        label: "提供方",
        kind: "select",
        value: "OpenRouter",
        options: ["OpenRouter", "DeepSeek", "Anthropic", "OpenAI"],
      },
      {
        name: "baseUrl",
        label: "Base URL",
        kind: "text",
        value: "openrouter.ai api/v1",
        error: "请填写主机和路径，例如 openrouter.ai/api/v1。",
      },
      {
        name: "apiKey",
        label: "API 密钥",
        kind: "password",
        value: "••••••••••••••••••••",
        hint: "在服务端加密保存，之后不再显示。",
      },
      {
        name: "notes",
        label: "备注",
        kind: "textarea",
        value: "文档专家的团队密钥，每 90 天轮换一次。",
      },
      {
        name: "proxy",
        label: "代理",
        kind: "text",
        value: "http://127.0.0.1:7890",
        hint: "由服务器的代理策略设定。",
        disabled: true,
      },
    ],
    errorSummary: "修正上面的字段后才能继续。",
    submit: "添加提供方",
    cancel: "取消",
    swatchLabels: ["跟随主题", "蓝色", "绿色", "紫色", "玫红", "琥珀"],
  },
  menus: {
    copy: "复制消息",
    fork: "从这里分叉对话",
    export: "导出为 Markdown",
    delete: "删除消息",
  },
  vault: {
    deepseek: { kind: "API 密钥", updated: "9月14日" },
    openrouter: { kind: "API 密钥", updated: "9月12日" },
    github: { kind: "令牌", updated: "9月9日" },
    slack: { kind: "Webhook", updated: "8月30日" },
    proxy: { kind: "密码", updated: "8月21日" },
    s3: { kind: "密钥", updated: "8月3日" },
  },
  plugins: {
    sdk: { description: "基于 PenguinHarness SDK 构建应用" },
    docsReview: { description: "检查渲染后的文档，找出失效链接与错误引用" },
    github: { description: "通过 MCP 处理 Issue、Pull Request 与评审" },
    slackNotify: { description: "任务结束时发送一条消息" },
  },
  palette: {
    groups: { commands: "命令", sessions: "最近的对话" },
    commands: {
      newChat: "新对话",
      switchModel: "切换模型",
      settings: "打开设置",
      search: "搜索会话",
    },
    hints: {
      newChat: "在当前 Project 中开始一个 Session",
      switchModel: "压缩当前上下文，换一个模型继续",
      settings: "外观、账户与服务器选项",
      search: "按标题和消息正文搜索",
    },
    sessions: [
      { title: "构建 Claude Code 文档专家", hint: "刚刚" },
      { title: "审阅 hooks.md 的引用", hint: "5 小时前" },
    ],
  },
  usage: {
    days: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
    buckets: { cacheRead: "缓存读取", cacheWrite: "缓存写入", output: "输出" },
  },
  specimens: {
    display: "会引用来源的智能体",
    heading: "两轮对话，提示缓存命中率 81%",
    paragraph:
      "PenguinHarness 用 DeepSeek V4 Pro 运行 claude-code-expert 会话 1 分 12 秒：共 43.8k tokens、$0.0231、7 次工具调用。BM25 索引覆盖 214 个 Markdown 文件，所以即便问 “How do I configure hooks?”，回答也会引用 corpus/claude-code-docs/hooks.md [1]。",
    ui: "运行中 · 6 步 · 34s — read_file …/src/rag.ts（421ms）· edit_file +3 −1 · $0.0110",
    caption: "最近同步 2026-09-14 14:02（UTC+8）· 48.2 KB · Trace #001",
    code: `// 引用必须指向语料库中真实存在的文件
const hits = rank("如何配置 hooks？").slice(0, 6).filter((c) => fs.existsSync(c.source));
console.log(\`命中 \${hits.length} 条，用时 \${(performance.now() - t0).toFixed(1)}ms\`); // 命中 6 条，用时 12.4ms`,
    numerals: "0123456789 · 1,048,576 tokens · ¥0.1617 · 71.8 秒 · 99.95% · 第 2 轮 · v0.2.13",
  },
});
