/**
 * The company-mode prototype's own words, in Chinese; `words-en.ts` holds the English, held to
 * the same shape by `Words`. Labels the shipped company mode already has (the page names, the
 * ticket's section titles, the board's columns) are read from the Web App's dictionary instead,
 * so the prototype says them as the app does. `tickets` is keyed by fixtures.ts.
 */
import type { FixtureId, HandbookDocId } from "./fixtures";

export interface TicketWords {
  title: string;
  /** One line: what it is and why it exists. */
  gist: string;
  acceptance: readonly string[];
  progress: readonly string[];
  question?: string;
  /** What its verifier finds, for a sample staged to come back from verification once. */
  found?: string;
  options?: readonly { label: string; hint: string }[];
  result?: string;
  /** The note it was sent back with, for a sample staged as sent back once. */
  returned?: string;
}

export const zh = {
  org: {
    name: "Harness 维护组",
    mission: "维护 penguin-harness 代码库：排查问题、修复缺陷，让新用户顺利完成首次配置。",
  },
  nav: {
    inbox: "收件箱",
    talk: "对主理说…",
    talkHint: "新的事都找主理，它会记成工单",
    team: "团队",
    handbook: "手册",
    board: "全部工单",
    record: "记录",
    sessionTab: (name: string, role: string, round: number | null) =>
      round === null ? `${name} · ${role}` : `${name} · ${role} ${round}`,
    usage: (tokens: string, cost: string) => `本月 ${tokens} Token · ${cost}`,
    pick: "在左栏选一张工单。",
    notStarted: "公司还没开始。说一句你关心的事，主理会提几张工单。",
    you: "你",
    openMenu: "打开导航",
  },
  /** An employee as one line of text, where a name alone would not say who it is. */
  who: (name: string, title: string) => `${name}（${title}）`,
  /** Each employee: a name, a title, and what it is responsible for. */
  people: {
    lead: {
      name: "顾言",
      title: "主理",
      duties: "接收需求，建立并分派工单；提议日程与招募，不编写代码。",
    },
    engineer: {
      name: "沈知远",
      title: "工程师",
      duties: "编写代码、修复缺陷，提交包含测试的 PR。",
    },
    verifier: {
      name: "林清越",
      title: "验证工程师",
      duties: "实机运行验证交付物并复现问题，确认后提交验收。",
    },
  },
  sources: {
    person: "你提出",
    patrol: "每日巡检",
    lead: "主理提议",
    retro: "复盘提议",
  },
  waits: { accept: "待接受", answer: "待回答", review: "待验收" },
  /** What a work session does on its ticket. */
  roles: { build: "开发", verify: "验证" },
  views: { waiting: "等你", working: "进行中", later: "稍后", handled: "已处理", archived: "归档" },
  inbox: {
    empty: {
      waiting: "无等你的工单",
      working: "无进行中工单",
      later: "无稍后处理工单",
      handled: "暂无已处理工单",
      archived: "无归档工单",
    },
    schedules: "日程",
    schedulesEmpty: "暂无日程。主理提议的日程接受后在此显示。",
  },
  ticket: {
    needsYou: "等你处理",
    asks: { accept: "是否批准执行？", review: "交付结果是否通过？" },
    kindNotes: {
      task: "接受后创建工作会话并更新进展，遇阻时发起提问。",
      schedule: "接受后每日定时巡检，发现问题自动生成待审工单。",
      role: "接受后该角色将加入团队并可作为工单负责人。",
      skill: "接受后装入对应员工技能目录，同类任务执行前读取；对应教训移出索引。",
      change: "接受后由主理执行改动；执行前为相关员工创建快照以支持撤回。",
    },
    accept: "接受",
    reject: "驳回",
    answer: "回答",
    /** An option's label when it is the one the session recommends. */
    recommended: (label: string) => `${label}（推荐）`,
    notePlaceholder: "补充说明（可选）",
    approve: "验收通过",
    sendBack: "打回",
    sendBackPlaceholder: "填写修改意见后打回",
    deliverable: "交付物",
    source: "来源",
    usage: (tokens: string, cost: string) => `${tokens} Token · ${cost}`,
    decisions: "决定",
    handbook: "记入手册",
    returned: "打回",
    saidInSession: "你在会话里说：",
    later: "稍后",
    archive: "归档",
    restore: "移回收件箱",
    waitingFirst: "这张工单在等你，处理后才能稍后或归档。",
    saidGoal: "你对主理说的原话。",
    saidProgress: "完成代码分析，开始实现。",
    saidResult: "任务完成，提交验收。",
    saidFound: "验证没通过，退回修改。",
    verifier: "验证",
    findings: "验证退回",
    reworkProgress: "已按打回意见完成修改。",
  },
  lead: {
    title: "主理",
    info: "常驻调度 Agent。负责接收需求、拆解工单并分派给工作会话，不编写代码。",
    placeholder: "输入需求，Enter 发送",
    send: "发送",
    empty: "暂无对话。输入需求后，主理将自动创建工单。",
    lines: {
      proposals: "已在收件箱中生成三项提议工单。你逐项决定，接受的才会开始。",
      filed: "已生成工单并启动工作会话。遇到疑问或完成后将通知收件箱。",
    },
  },
  setup: {
    title: "设定关注目标",
    body: "输入需要关注的目标。主理将生成提议工单供逐项确认，无需长篇提案或群聊沟通。",
    placeholder: "例如：维护 penguin-harness 代码库，排查问题与修复缺陷",
    start: "开始",
    examples: [
      "维护 penguin-harness 代码库：排查问题、修复缺陷",
      "每日整理新 issue 并修复明确缺陷",
      "优化新用户首次配置流程",
    ],
    examplesLabel: "示例",
  },
  team: {
    title: "团队",
    info: "员工包含姓名、职位和职责。仅主理常驻，其他员工仅在所负责工单的会话中执行任务。",
    hire: "招人",
    hireHint: "招人或调整职责请告知主理，主理会提一张工单给你决定。",
    reportsTo: (name: string) => `向${name}汇报`,
    standing: "常驻",
    usage: (tokens: string, cost: string) => `本月 ${tokens} Token · ${cost}`,
    working: "在做",
    idle: "当前无进行中的工单",
    pending: "待加入",
    pendingNote: "提议已发至收件箱，接受后生效。",
    metrics: (firstPass: number, accepted: number, sendBacks: number, cost: string) =>
      `一次通过 ${firstPass} / ${accepted} · 打回 ${sendBacks} 次 · 每张通过 ${cost}`,
    noMetrics: "暂无已完成的工单",
    learnedTitle: "自己学到的",
    learnedInfo: "被打回或被你纠正时，自动记进自己的技能 notes，不用你批。",
    learned: (version: number, title: string) => `notes 第 ${version} 版：来自「${title}」`,
  },
  session: {
    info: "工作会话的执行记录。工单仅保留最终结论，可在会话中查看过程或直接交代。",
    status: { running: "运行中", verifying: "验证中", ended: "已结束" },
    handoff: (name: string) => `交给${name}验证。`,
    handed: (name: string) => `${name}交来的交付`,
    fromVerifier: (name: string) => `${name}（验证）`,
    found: (finding: string) => `没通过：${finding}`,
    verified: "按验收标准逐条验证，全部通过，交给你验收。",
    brief: "主理已将该工单分配至本会话。",
    answered: (label: string) => `选「${label}」。`,
    sentBack: (note: string) => `打回：${note}`,
    noted: "收到，已同步记录至工单。",
    waitingAnswer: "会话停在问题上，等你回答。",
    waitingReview: "执行完毕，等待验收。",
    ended: "会话已结束，最终结论已记录在工单中。",
    placeholder: "直接和这个会话说，Enter 发送",
    send: "发送",
  },
  schedule: {
    info: "日程定期生成工单。初始为提议模式，开启自动开工后生成的工单将直接执行。",
    names: { patrol: "每日巡检：看新 issue 和 CI", retro: "每周复盘：回看上周关闭的工单" },
    when: { patrol: "每天 09:00", retro: "每周一 09:00" },
    auto: "生成工单后直接开工",
    autoOn: "直接开工",
    autoOff: "仅提议",
  },
  pass: {
    button: "让时间过去",
    hint: "原型未运行实时 Agent，点击推进工作会话进度。",
    nothing: "无最新动态：所有工单均在等待处理或已完成。",
    events: {
      progress: (title: string) => `「${title}」更新进展`,
      asked: (title: string) => `「${title}」等待回答提问`,
      delivered: (title: string) => `「${title}」已完成，等待验收`,
      proposed: (title: string) => `巡检提议：「${title}」`,
      started: (title: string) => `巡检自动开工：「${title}」`,
      retro: (n: string) => `主理完成第 ${n} 次复盘，提议已发至收件箱`,
    },
  },
  tickets: {
    csv: {
      title: "给导出加上 CSV",
      gist: "导出页除了 JSON，还能导出 CSV。",
      acceptance: ["十万行的导出不超时", "现有的 JSON 导出不变"],
      progress: [
        "完成导出模块分析，梳理出两种方案。",
        "按照选定方案完成实现，十万行导出耗时 1.8 秒。",
        "已修复：输出改为带 BOM 的 UTF-8，补了中文文件名的测试。",
      ],
      found: "中文文件名的导出在 Excel 里乱码：CSV 没有带 BOM。",
      question: "大文件导出：流式写出，还是一次生成？",
      options: [
        { label: "流式写出", hint: "内存占用稳定，逻辑多一层封装" },
        { label: "一次生成", hint: "逻辑简单，超十万行存在超时风险" },
      ],
      result: "已完成 CSV 导出功能并补充回归测试。",
    },
    connection: {
      title: "首次配置时增加连接测试",
      gist: "填写 API key 后支持一键测试连接可用性。",
      acceptance: ["密钥无效、网络异常与模型不存在分别提供明确提示", "支持未保存配置前执行测试"],
      progress: [
        "在模型配置弹窗中增加「测试连接」按钮。",
        "覆盖三种错误场景的明确提示，并补充相关测试。",
      ],
      result: "已完成连接测试功能，覆盖全部错误场景提示。",
    },
    flaky: {
      title: "修复偶发失败的导出测试",
      gist: "导出测试在 CI 中偶发超时，最近 20 次运行失败 3 次。",
      acceptance: ["连续运行 50 次全部通过"],
      progress: ["已定位根因：大文件导出用例的测试等待超时阈值偏低。"],
      result: "等待超时已改为按文件大小动态计算，连续运行 50 次通过。",
    },
    jitter: {
      title: "复现窗口缩放时的侧栏抖动",
      gist: "窗口宽度在 1024px 附近拖动时，侧边栏出现反复折叠。",
      acceptance: ["输出稳定复现步骤", "定位触发异常的响应式断点"],
      progress: [
        "确认在 1020px 至 1028px 区间稳定复现。",
        "根因为两处断点计算使用了不同的取整规则。",
      ],
      result: "已在报告中详细记录复现步骤与成因，修复工作另建工单。",
    },
    types: {
      title: "升级 @types/node",
      gist: "适配 Node 24 类型定义。",
      acceptance: ["类型检查全部通过"],
      progress: ["完成依赖升级并修复 4 处类型不兼容。"],
      result: "升级完成，类型检查通过。",
    },
    docs: {
      title: "修正快速开始里的端口号",
      gist: "快速开始文档记录端口为 7364，开发模式实际使用 7365。",
      acceptance: ["同步更新中英双语文档"],
      progress: ["已更新中文文档的端口号。"],
      result: "中英文档均已修正。",
      returned: "英文文档中的端口号尚未更新。",
    },
    timeout: {
      title: "给模型请求加上超时提示",
      gist: "模型请求超过 60 秒未响应时界面缺少状态提示。",
      acceptance: ["超时后展示明确提示与重试按钮"],
      progress: ["已添加超时提示与重试按钮。"],
      result: "超时提示与重试功能已完成。",
    },
    lint: {
      title: "清理 12 处未使用的导入",
      gist: "日常巡检发现 12 处未使用导入的 lint 告警。",
      acceptance: ["lint 检查无任何告警"],
      progress: ["已清理全部 12 处未使用导入。"],
      result: "lint 告警全部消除。",
    },
    survey: {
      title: "摸清代码库现状",
      gist: "梳理代码库、近期 issue 及 CI 运行记录，整理单页现状报告。",
      acceptance: ["报告篇幅控制在一页内", "梳理出优先级最高的三项改进"],
      progress: [
        "已分析近 30 天的 issue 与 CI 记录。",
        "完成单页报告编写，列出优先级最高的三项任务。",
      ],
      result: "代码库现状报告已归档至手册。",
    },
    patrol: {
      title: "每日巡检：每天 09:00 看新 issue 和 CI",
      gist: "每日定时检查新增 issue 与 CI 运行状态，将异常项生成工单。",
      acceptance: ["初期仅生成提议工单，做不做由你决定"],
      progress: [],
    },
    verifier: {
      title: "加一名专职验证",
      gist: "交付物先由独立 Agent 实机运行验证，确认无误后再交给你验收。",
      acceptance: ["代码实现与验证由不同 Agent 分开执行"],
      progress: [],
    },
    skill: {
      title: "提炼技能：中英文档同步修改",
      gist: "工单「修正快速开始里的端口号」曾因遗漏英文更新被打回。将双语核对步骤提炼为技能并配置给沈知远。",
      acceptance: ["技能明确要求修改后双语同步核对", "配置给负责文档维护的工程师"],
      progress: [],
    },
    patrolScope: {
      title: "巡检不再提议依赖升级",
      gist: "巡检生成的依赖升级工单已被驳回。后续依赖升级仅在你提出时执行，巡检范围限定为 issue 与 CI。",
      acceptance: ["调整巡检日程提示词，移除依赖版本检查"],
      progress: [],
    },
  } satisfies Record<FixtureId, TicketWords>,
  handbook: {
    title: "手册",
    info: "组织知识库，对应 handbook/ 目录。主理在此记录决定、打回教训，以及你接受后装给员工的技能。员工执行任务前先读这里。",
    groups: {
      index: "目录",
      retro: "复盘",
      decision: "决定",
      lesson: "教训",
      skill: "技能",
      doc: "文档",
    },
    merged: "已并入技能",
    mergedNote: "该教训已并入技能并移出索引，后续任务直接读取技能。",
    version: (n: number) => `第 ${n} 版`,
    retroTitle: (n: number, closed: number) => `第 ${n} 次复盘：${closed} 张工单`,
    retroLine: (
      closed: number,
      accepted: number,
      firstPass: number,
      sendBacks: number,
      questions: number,
      cost: string,
    ) =>
      `关闭 ${closed} 张（完成 ${accepted} 张，一次就通过 ${firstPass} 张）；打回 ${sendBacks} 次；提问 ${questions} 次；平均每张工单花费 ${cost}。`,
    retroBaseline: "首次复盘数据作为后续对比基准。",
    retroBefore: (firstPass: number, accepted: number, sendBacks: number, cost: string) =>
      `上次数据：一次就通过 ${firstPass} / ${accepted}，打回 ${sendBacks} 次，每张工单 ${cost}。`,
    retroEffect: (title: string, name: string, closed: number, sendBacks: number) =>
      `采纳「${title}」后，${name}关闭 ${closed} 张工单，打回 ${sendBacks} 次。`,
    retroProposals: (titles: string) => `本次提议优化：${titles}，已发至收件箱，等你决定。`,
    retroNothing: "本次复盘无变更项。",
    quote: (title: string) => `「${title}」`,
    join: "、",
    empty: "暂无",
    from: "来自工单",
    installedOn: "已配置给",
    decisionBody: (label: string) => `采纳方案「${label}」。`,
    lessonTitle: (title: string) => `打回：${title}`,
    lessonAfter: "下次同类工单交付前，先检查这一点。",
    docs: {
      readme: {
        title: "手册目录",
        body: [
          "组织知识库。员工执行任务前预先读取对应规则。",
          "决定：你回答过的问题。同类场景直接遵循既有决定，不再重复询问。",
          "教训：打回交付物的原因记录及后续规避措施。",
          "技能：从教训里提炼的固定做法，你接受后装进员工自己的技能目录。",
          "文档：工单交付的技术说明与分析报告。",
          "复盘：主理每周一回看上周关闭的工单，统计一次就通过的数量、打回数、提问数与花费，并提出要改什么。",
        ],
      },
      state: {
        title: "代码库现状",
        body: [
          "近 30 天新增 42 个 issue，其中 9 个与导出相关。",
          "CI 失败集中于导出测试：最近 20 次运行中失败 3 次，因等待超时过短。",
          "建议优先处理：修复偶发失败的导出测试、首次配置增加连接测试、导出支持 CSV。",
        ],
      },
      docsLesson: {
        title: "文档修改需同步中英双语",
        body: [
          "工单「修正快速开始里的端口号」因仅修改中文页被打回。",
          "修改文档时必须定位对应语言版本并同步修改，交付前核对数值与命令。",
        ],
      },
      bilingualSkill: {
        title: "bilingual-docs：中英文档同步修改",
        body: [
          "何时使用：工单修改 packages/docs 目录下的任意页面。",
          "1. 定位该页面在 zh 和 en 目录中的对应文件。",
          "2. 在双语文件中应用相同修改。",
          "3. 交付前逐段核对两边的数值、命令与链接。",
        ],
      },
    } satisfies Record<HandbookDocId, { title: string; body: readonly string[] }>,
  },
};

export type Words = typeof zh;
