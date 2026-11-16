/**
 * The company-mode prototype's own words, in Chinese; `words-en.ts` holds the English, held to
 * the same shape by `Words`. Labels the shipped company mode already has (the page names, the
 * ticket's section titles, the board's columns) are read from the Web App's dictionary instead,
 * so the prototype says them as the app does. `tickets` is keyed by fixtures.ts.
 */
import type { DraftId, FixtureId, HandbookDocId, Species } from "./fixtures";

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
    pick: "在左栏选一张工单。",
    notStarted: "公司还没开。定好使命和团队，主理会提几张工单给你定。",
    you: "你",
    openMenu: "打开导航",
  },
  /** An employee as one line of text, where a name alone would not say who it is. */
  who: (name: string, title: string) => `${name}（${title}）`,
  /** Every company's two standing employees: a title, and what each is responsible for. */
  people: {
    lead: {
      title: "主理",
      duties: "接需求、建工单，分派给负责的人；提议日程和招人，自己不动手。",
    },
    verifier: {
      title: "验证",
      duties: "对照验收标准检查每份交付：代码实机跑，文章核对事实和链接，数字重跑一遍。",
    },
  },
  /** Every employee is named after a penguin species. */
  species: {
    emperor: "帝企鹅",
    chinstrap: "帽带企鹅",
    gentoo: "巴布亚企鹅",
    littleBlue: "小蓝企鹅",
    adelie: "阿德利企鹅",
    king: "王企鹅",
    rockhopper: "跳岩企鹅",
    macaroni: "马可罗尼企鹅",
  } satisfies Record<Species, string>,
  /** The roles the lead can draft from a mission: a title, what it does, and what it watches. */
  drafts: {
    engineer: {
      title: "工程师",
      duties: "修缺陷、做功能，提交带测试的 PR。",
      sources: "issue 和 CI",
    },
    operations: {
      title: "运营",
      duties: "写文章、发版说明和文档，回复读者，整理社区问题。",
      sources: "文档、博客和社区讨论",
    },
    editor: {
      title: "内容编辑",
      duties: "按选题写文章和视频脚本，发布前核对事实和链接。",
      sources: "选题表和已发内容",
    },
    community: {
      title: "社区运营",
      duties: "回复读者的问题，每周汇总一次社区反馈。",
      sources: "社区讨论和读者留言",
    },
    docs: {
      title: "文档维护",
      duties: "改正文档里的错漏，给新功能补页面，中英两版同步。",
      sources: "文档站和相关 issue",
    },
    digest: {
      title: "更新摘要编辑",
      duties: "每周把合并的改动和新发布写成一期摘要。",
      sources: "合并的 PR 和发版记录",
    },
    researcher: {
      title: "研究员",
      duties: "设计并跑实验，结果记进日志，写成报告。",
      sources: "实验日志、评测集和相关论文",
    },
    analyst: {
      title: "数据分析",
      duties: "整理数据，回答使命里要看的数字，写成图表和结论。",
      sources: "数据表和日志",
    },
    assistant: {
      title: "助理",
      duties: "按使命做事，拿不准的先问你。",
      sources: "工作区",
    },
  } satisfies Record<DraftId, { title: string; duties: string; sources: string }>,
  sources: {
    person: "你提出",
    patrol: "每日巡检",
    lead: "主理提议",
    retro: "复盘提议",
  },
  waits: { accept: "待接受", answer: "待回答", review: "待验收" },
  /** What a work session does on its ticket. */
  roles: { build: "干活", verify: "验证" },
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
    saidProgress: "相关内容已看完，开始动手。",
    saidResult: "任务完成，提交验收。",
    saidFound: "验证没通过，退回修改。",
    verifier: "验证",
    findings: "验证退回",
    reworkProgress: "已按打回意见完成修改。",
  },
  lead: {
    title: "主理",
    info: "常驻的调度 Agent。接需求、拆成工单，交给负责那一块的员工在工作会话里做，自己不动手。",
    placeholder: "输入需求，Enter 发送",
    send: "发送",
    acceptAll: "全部接受",
    empty: "暂无对话。输入需求后，主理将自动创建工单。",
    lines: {
      proposals:
        "读完了，你定的运作方式也已写进手册的「公司怎么运作」。先提这几件事，你接受的才会开始：",
      settled:
        "都定了。从现在起，只有需要你接受、回答或验收的工单会出现在「等你」里，其余的不打扰你。",
      filed: "已生成工单并启动工作会话。遇到疑问或完成后将通知收件箱。",
    },
  },
  setup: {
    title: "开一家公司",
    body: "先选公司的大方向，再按需要改写使命。主理按使命提出团队，人尽量少。",
    /** The broad directions a company can take: a name, one line, and the mission it fills in. */
    templates: {
      code: {
        name: "代码维护",
        summary: "修缺陷、整理 issue、守住 CI",
        mission: "维护这个代码仓库：每天看新 issue 和 CI，修掉明确的缺陷，每个修复都带测试。",
      },
      content: {
        name: "内容运营",
        summary: "写文章和视频脚本，回复读者，汇总反馈",
        mission:
          "运营内容和社区：按选题写文章和视频脚本，发布前核对事实和链接，回复读者的问题，每周汇总一次社区反馈。",
      },
      research: {
        name: "研究实验",
        summary: "定好指标，跑实验，写成报告或论文",
        mission:
          "做研究：先固定评测和指标，再逐个跑实验，结果记进日志，只保留有提升的改动，最后写成报告或论文。",
      },
    },
    own: "自己写",
    ownSummary: "从一句使命开始，主理按它提人",
    /** The company's name when the reader writes their own mission. */
    ownName: "我的公司",
    /** The sidebar's name for a company not started yet. */
    newOrg: "新公司",
    mission: "使命",
    missionInfo: "一句话说明公司做什么。主理按它提出团队和第一批工单，之后能在设置里改。",
    missionPlaceholder: "例如：为 PenguinHarness 维护文档站，并每周发布一期更新摘要",
    /** Words in a mission that call for each role, for a mission the reader wrote. */
    keywords: {
      engineer: ["代码", "仓库", "缺陷", "bug", "CI", "测试", "功能"],
      editor: ["文章", "视频", "脚本", "选题", "公众号", "内容"],
      community: ["社区", "读者", "用户反馈", "答疑", "回复"],
      docs: ["文档"],
      digest: ["摘要", "周报", "月报", "更新"],
      researcher: ["研究", "实验", "评测", "论文", "模型"],
      analyst: ["数据", "分析", "报表", "指标"],
    } satisfies Partial<Record<DraftId, readonly string[]>>,
    team: {
      title: "要哪几个人",
      body: (workspace: string) =>
        `主理读了使命和工作区 ${workspace}，拟了这几个角色，人尽量少。名字和职责都能改，也可以去掉或加人。`,
      lead: "常驻，接需求、分派工单",
      roleTitle: "职位",
      roleDuties: "负责什么",
      sources: (sources: string) => `来源：${sources}`,
      remove: (name: string) => `去掉${name}`,
      add: "加一个角色",
      addPlaceholder: "例如：翻译",
      dutiesPlaceholder: "这个角色负责什么",
      none: "至少留一个角色，公司才有人干活。",
      untitled: "每个角色都要有职位。",
    },
    defaults:
      "第 3 到 5 步的选择会写进手册里的「公司怎么运作」，每个员工开工前都读。公司名取所选方向的名字，模型用 Project 默认的。这些之后都能改。",
    start: "开公司",
    steps: {
      mission: "做什么",
      team: "团队",
      flow: "工单怎么走",
      schedules: "日程",
      style: "说话方式",
    },
    next: "下一步",
    back: "上一步",
    flow: {
      title: "一张工单怎么走",
      body: "从提议到验收经过四站。验证这一站可以关掉。",
      note: "只有提议、提问和验收这三处会找你，其余的不打扰你。",
      propose: { title: "提议", body: "主理把要做的事提成工单，你接受才开始。" },
      work: {
        title: "干活",
        body: "员工在自己的工作会话里做。拿不准的事只问你一个问题，工作停下等你回答。",
      },
      verify: {
        title: "验证",
        label: "交付先验证",
        on: (name: string) =>
          `交付先由${name}对照验收标准检查：代码实机跑，文章核对事实和链接。不通过就退回给负责的人，不打扰你。`,
        off: "交付不经验证，直接交给你验收。",
      },
      review: { title: "验收", body: "你接受，或附一句话打回。打回的原因记进手册，下次先检查。" },
    },
    schedules: {
      title: "主理自己找事做",
      body: "主理按日程看各块的来源，不用你开口。巡检的发现怎么处理由你定。",
      patrol: "每日巡检",
      patrolWhen: (sources: string) => `每天 09:00，来源：${sources}`,
      patrolHint: {
        off: "主理不主动看。之后可以在日程页打开。",
        propose: "发现的问题提成工单，等你接受。",
        auto: "发现的问题直接开工，做完才找你验收。",
      },
      retro: "每周复盘",
      retroWhen: "每周一 09:00",
      retroHint: "回看上周关闭的工单，要改的提成工单给你。复盘只提议，不会自己改。",
    },
    style: {
      title: "员工怎么跟你说话",
      body: "改一个选项，旁边的示例工单就按新的写法写。",
      record: { label: "工单记录", points: "要点", prose: "段落" },
      ask: { label: "提问", options: "给选项和推荐", open: "只提问题" },
      progress: { label: "进展", milestones: "关键节点", every: "每一步" },
    },
    preview: {
      title: "预览：一张工单会这样写",
      progress: "进展",
      question: "问你",
      result: "结果",
      steps: [
        "已整理这一版合并的 23 个 PR，分成 5 组。",
        "初稿写完，中英两版都有。",
        "正在逐条核对 PR 链接。",
      ],
      milestone: 1,
      ask: {
        options: "发版说明先写哪部分？",
        open: "发版说明的开头你希望写什么？",
        choices: ["先写不兼容的改动", "先写新功能"],
        recommended: "推荐",
      },
      points: ["2 处不兼容的改动放在最前，各附迁移步骤", "其余 21 个 PR 按 5 组写，每条一句话"],
      prose:
        "这一版有 2 处不兼容的改动，放在最前面，各附了迁移步骤。其余 21 个 PR 按用户能感知的变化分成 5 组，每条一句话。",
    },
  },
  /** The sample company: it runs PenguinHarness. */
  org: "PenguinHarness",
  team: {
    total: (tokens: string, cost: string) => `全公司本月 ${tokens} Token · ${cost}`,
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
    info: "日程定期生成工单。巡检可以关掉、只提议，或直接开工；复盘只提议。",
    names: { patrol: "每日巡检：看各块有什么新情况", retro: "每周复盘：回看上周关闭的工单" },
    when: { patrol: "每天 09:00", retro: "每周一 09:00" },
    modes: { off: "不巡检", propose: "仅提议", auto: "直接开工" },
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
      title: "摸清项目现状",
      gist: "读一遍工作区和团队各块的来源，整理一页现状报告。",
      acceptance: ["报告不超过一页", "每一块列出最该先做的事"],
      progress: ["已看完工作区和各块近 30 天的来源。", "单页报告写完，每一块列出了最该先做的事。"],
      result: "项目现状报告已记进手册。",
    },
    patrol: {
      title: "每日巡检：每天 09:00 看新 issue、CI 和社区",
      gist: "每天定时看新 issue、CI 和社区讨论，要处理的提成工单。",
      acceptance: ["初期仅生成提议工单，做不做由你决定"],
      progress: [],
    },
    verifier: {
      title: "加一名专职验证",
      gist: "交付先由另一名员工对照验收标准检查，确认无误再交给你验收。",
      acceptance: ["干活和验证由不同的员工做"],
      progress: [],
    },
    skill: {
      title: "提炼技能：中英文档同步修改",
      gist: "工单「修正快速开始里的端口号」曾因漏改英文被打回。把中英核对的步骤提炼成技能，配置给小蓝企鹅。",
      acceptance: ["技能要求改完后中英两版逐段核对", "配置给负责文档的运营"],
      progress: [],
    },
    patrolScope: {
      title: "巡检不再提议依赖升级",
      gist: "巡检提的依赖升级工单被驳回了。以后依赖升级只在你提出时做，巡检不再看依赖版本。",
      acceptance: ["调整巡检日程提示词，移除依赖版本检查"],
      progress: [],
    },
    release: {
      title: "写 0.3 的发版说明",
      gist: "把这一版合并的 23 个 PR 写成用户读得懂的发版说明，中英各一份。",
      acceptance: ["不兼容的改动放在最前，附迁移步骤", "每条链接指向对应的 PR"],
      progress: [
        "已整理这一版合并的 23 个 PR，分成 5 组。",
        "初稿写完，中英两版都有。",
        "已修正：两条链接改回对应的 PR。",
      ],
      found: "有两条链接指错了 PR：「连接测试」那条指到了 CSV 导出的 PR。",
      result: "发版说明写好了，中英两版的链接都已核对。",
    },
    community: {
      title: "整理本周社区问题",
      gist: "把社区讨论和群里本周的问题归成几类，常问的补进文档。",
      acceptance: ["每类附上原帖链接"],
      progress: ["本周 14 个问题归成 4 类，其中 3 类已有文档可答。"],
      result: "整理完了，缺文档的那一类另提了工单。",
    },
    discussion: {
      title: "回复社区里 3 个没人回的问题",
      gist: "社区讨论里有 3 个问题两天没人回，都和首次配置有关。",
      acceptance: ["每个回复附上对应文档的链接"],
      progress: ["3 个问题都回复了，附上了快速开始的链接。"],
      result: "3 个问题都已回复。",
    },
    evals: {
      title: "在评测集上对比两个新模型",
      gist: "上个月新出的两个模型还没在评测集上跑过。先跑一遍，再决定要不要加进模型目录。",
      acceptance: ["每个模型跑 3 次，报告平均分和波动", "附上每次运行的 Trace"],
      progress: [
        "两个模型各跑完 3 次，分数已记下。",
        "报告写完：其中一个比现在的默认模型高 4 分，花费多 30%。",
      ],
      result: "报告写完了。要不要加进模型目录，另提工单给你定。",
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
    /** how-we-work.md, written from the company's settings. */
    howWeWork: {
      verify: {
        on: (name: string) => `交付先由${name}对照验收标准检查，通过后才交给你验收。`,
        off: "交付直接交给你验收，不经验证。",
      },
      patrol: {
        off: "不巡检。",
        propose: "每日巡检发现的问题提成工单，等你接受。",
        auto: "每日巡检发现的问题直接开工，做完才找你验收。",
      },
      retro: "每周一复盘，要改的提成工单，等你接受。",
      record: { points: "工单记录写成要点。", prose: "工单记录写成完整的段落。" },
      ask: {
        options: "提问时给两三个选项，标出推荐的那个。",
        open: "提问时只提问题，不预设选项。",
      },
      progress: { milestones: "进展只记关键节点。", every: "进展每一步都记。" },
      change: "要改这些，告诉主理；巡检也可以直接在日程页改。",
    },
    docs: {
      howWeWork: { title: "公司怎么运作", body: [] as string[] },
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
        title: "项目现状",
        body: [
          "代码：近 30 天新增 42 个 issue，9 个和导出有关。CI 最近 20 次失败 3 次，都卡在导出测试的等待超时上。",
          "内容和社区：英文文档比中文多改了 9 次；社区里 3 个问题两天没人回。",
          "评测：上个月新出的两个模型还没在评测集上跑过。",
          "建议先做：修好导出测试、写 0.3 的发版说明、评测两个新模型。",
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
