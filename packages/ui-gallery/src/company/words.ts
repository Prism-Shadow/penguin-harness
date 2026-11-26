/**
 * The company-mode prototype's own words, in Chinese. This dictionary defines the shape
 * (`Words`); words-en.ts follows it. The sample work's words are keyed by fixture id.
 */
import type { FixtureId, MachineId, MemberId, Perm, Scenario, Species } from "./fixtures";
import type { HaltChoice, TourItem } from "./model";
import type {
  InboxGroup,
  OutwardAction,
  OutwardGrade,
  TicketStatus,
  Trigger,
  Wait,
  Workbench,
} from "./spec";

/** One piece of sample work: what it is for, how it is accepted, what it delivered. */
export interface TicketWords {
  title: string;
  goal: string;
  criteria: string[];
  result: string;
  /** The verifier's findings, by the index a send-back names. */
  findings?: string[];
  /** The lesson each finding became, in the executor's skill. */
  lessons?: string[];
  /** The question the work stopped on, and its options by id. */
  ask?: {
    question: string;
    context: string;
    options: Record<string, { label: string; description: string }>;
  };
  /** A call made on it earlier, as the handbook writes it. */
  ruled?: string;
}

export interface DocWords {
  /** Each delivered version's paragraphs. */
  versions: string[][];
  /** The verifier's comments, pinned to a paragraph of a version. */
  comments: { version: number; paragraph: number; text: string }[];
}

export interface LedgerRow {
  item: string;
  text: string;
  risk: "ok" | "watch" | "block";
  note: string;
}

export interface Draft {
  where: string;
  author: string;
  post: string;
  draft: string;
}

export const zh = {
  org: { sample: "浮冰工作室", fresh: "新组织", tagline: "一人公司 · 开源笔记应用 Floe" },
  colon: "：",
  you: "你",
  species: {
    emperor: "帝企鹅",
    chinstrap: "帽带企鹅",
    gentoo: "巴布亚企鹅",
    adelie: "阿德利企鹅",
    king: "王企鹅",
  } satisfies Record<Species, string>,
  roles: {
    lead: { title: "主理", duties: "跟你聊清目标，建组拆单，复盘提优化；自己不干活。" },
    dev: { title: "开发", duties: "修 Bug、写功能、提 PR；不能合并。" },
    research: { title: "研究", duties: "跑评测和实验，出曲线和结论。" },
    ops: { title: "运营与文书", duties: "写文档、审合同、对账、拟回复草稿；一律不代发。" },
    verifier: {
      title: "验证",
      duties: "对照验收标准独立检查每份交付；用自己的只读令牌，不能放行自己的活。",
    },
  } satisfies Record<MemberId, { title: string; duties: string }>,
  machines: {
    laptop: { name: "本机 MacBook Pro", state: "在线" },
    gpu: { name: "gpu-box（SSH）", state: "在线 · 1×A100" },
    cloud: { name: "云端常驻机", state: "待命" },
  } satisfies Record<MachineId, { name: string; state: string }>,
  perms: {
    files: "读写工作区",
    branch: "开分支、提 PR",
    tests: "跑测试",
    gpu: "用 GPU",
    drafts: "只写草稿",
    readonly: "只读令牌",
    noMerge: "不能合并",
    tickets: "建单派单",
  } satisfies Record<Perm, string>,
  workbenches: {
    code: "代码对比",
    experiment: "实验曲线板",
    document: "长文档",
    ledger: "台账",
    outreach: "预填草稿",
  } satisfies Record<Workbench, string>,
  work: {
    code: "代码维护",
    experiment: "科研实验",
    document: "文档与长文",
    ledger: "合同与账务",
    outreach: "社区与外联",
  } satisfies Record<Workbench, string>,
  statuses: {
    proposed: "提议",
    working: "执行",
    verifying: "验证",
    deciding: "待拍板",
    done: "完成",
    dropped: "已停",
  } satisfies Record<TicketStatus, string>,
  holders: { person: "你", executor: "执行者", verifier: "验证者" },
  waits: {
    accept: "待采纳",
    ask: "待回答",
    halt: "已熔断",
    decide: "待验收",
  } satisfies Record<Wait, string>,
  groups: {
    decide: "待拍板",
    moving: "进行中",
    settled: "已收尾",
  } satisfies Record<InboxGroup, string>,
  groupEmpty: {
    decide: "没有要你拍板的事",
    moving: "没有进行中的工单",
    settled: "还没有收尾的工单",
  } satisfies Record<InboxGroup, string>,
  sources: {
    user: "你提的",
    lead: "主理开的",
    github: "GitHub Issue",
    message: "外部消息",
    patrol: "每日巡检",
    review: "复盘提议",
  },
  outward: {
    actions: {
      reply: "回复帖子",
      merge: "合并 PR",
      publish: "发布",
      email: "发邮件",
      experiment: "跑大实验",
    } satisfies Record<OutwardAction, string>,
    grades: {
      draft: "预填草稿，你来发",
      approve: "一键批准",
      review: "复核后批准",
    } satisfies Record<OutwardGrade, string>,
    gradeHint: {
      draft: "组织只写草稿，从不代发",
      approve: "验证通过后，你点一下就执行",
      review: "先看清花多少钱、对谁有约束，再确认",
    } satisfies Record<OutwardGrade, string>,
  },
  triggers: {
    github: "GitHub Issue",
    message: "外部消息（邮件、表单）",
    callback: "回调（CI、支付）",
    patrol: "每日巡检 09:00",
    review: "每周复盘 周五",
  } satisfies Record<Trigger, string>,
  scenarios: {
    solo: {
      label: "一人公司",
      line: "代码、实验、文档、社区都要人手",
      prompt:
        "我一个人在做一个开源笔记应用，还卖托管版。帮我把代码、评测、文档和社区回复都管起来。",
    },
    software: {
      label: "软件维护",
      line: "修 Issue、提 PR、补文档",
      prompt: "帮我维护一个开源仓库：处理 Issue、修 Bug、补文档。",
    },
    research: {
      label: "科研实验",
      line: "跑评测、出曲线、写报告",
      prompt: "帮我跑模型评测实验，出曲线和结论，再写成报告。",
    },
    business: {
      label: "垂直业务",
      line: "审合同、对账、拟回复",
      prompt: "帮我处理合同审阅、月度对账和客户邮件。",
    },
  } satisfies Record<Scenario, { label: string; line: string; prompt: string }>,

  nav: {
    lead: "主理",
    leadHint: "提需求、问进度，都找主理",
    team: "团队",
    rules: "规则",
    handbook: "手册与技能",
    review: "复盘与评测",
    inbox: "收件箱",
    openMenu: "打开菜单",
    draft: "有未发送的草稿",
    pick: "从左边选一张工单。",
  },
  steps: {
    title: "开局",
    items: ["看环境", "说目标", "答几个问题", "确认清单"],
  },

  onboarding: {
    hello:
      "你好，我是主理帝企鹅。之后你只跟我说话：我负责聊清目标、建组、拆工单，日常只把卡点和要你拍板的事推给你。",
    found: "先看了一下你的环境：",
    machines: "机器",
    models: (n: number): string => `已配置 ${n} 个模型，可按岗位分配`,
    clis: (names: string): string =>
      `检测到 ${names}：可以作为可选的外部执行通道（扩展方向，尚未接入）`,
    ask: "这个组织要干什么？挑一个起步，或者直接告诉我。",
    import: "导入组织模板包",
    imported:
      "已从模板包 floe-solo.penguin-org 读入角色、机器、权限和规则。过一遍清单，没问题就创建。",
    placeholder: "说说你想让这个组织干什么",
    placeholderLater: "先回答上面的卡片",
    send: "发送",
    questions: "好。三个问题，答完我出一份组织清单给你过目。",
    form: {
      title: "开局三问",
      work: "主要交付的活",
      workHint: "每类活配一名执行者，最多三名",
      budget: "单张工单预算上限",
      rounds: "验证者打回轮次上限",
      events: "GitHub Issue、外部消息一来就开单",
      submit: "就这样",
    },
    previewIntro: "按你的回答，我拟了一份清单。确认前都能改，确认后我才动手。",
    preview: {
      title: "组织清单",
      team: "编制",
      teamNote: "默认最少编制：1 主理 + 1~3 执行 + 1 验证。忙不过来时我再提议加人。",
      work: "交付的活",
      flow: "状态机",
      flowNote: "验证不通过自动打回执行者；只有卡点和待拍板进你的收件箱。",
      limits: "硬门禁（写在服务端）",
      budget: "单张工单预算",
      rounds: "打回轮次上限",
      depth: (n: number): string => `委派深度不超过 ${n} 层，防循环`,
      verified: "未经验证不放行",
      outward: "对外动作",
      triggers: "触发",
      eventsOn: "事件一到立即唤醒主理",
      eventsOff: "只按巡检和复盘的时间表",
      workbenches: "验收台",
      first: "先开的工单",
      warnings: "边界提醒",
      warnToken:
        "验证者用单独的只读 GitHub 令牌：和开发共用一个账号时，GitHub 不允许自己批准自己的 PR。",
      warnOutward: "合并、发布、发邮件、跑大实验都会先进你的收件箱，组织不会自己执行。",
      model: "模型",
      confirm: "确认并开始创建",
    },
    creating: [
      "写入 org/README.md 和 org/how-we-work.md",
      "建好成员，各自的 Skill 从 v1 开始",
      "状态机与硬门禁已登记到服务端",
      "拆出首批工单，已派给执行者",
    ],
    created: "组织建好了。之后我只在需要你的时候出声：让时间过去，看工单怎么流转。",
    enter: "进入收件箱",
    answered: "已回答",
  },

  lead: {
    title: "主理",
    intro:
      "有新需求就跟我说。我会先给你看工单草稿，你点确认才开单。没有大群聊，执行者之间的交接都在工单里。",
    suggestions: "可以试试",
    placeholder: "说一个新需求",
    send: "发送",
    previewTitle: "工单草稿",
    owner: "执行",
    verifier: "验证",
    workbench: "验收台",
    limits: "预算 / 轮次",
    outward: "对外动作",
    none: "无",
    confirm: "确认开单",
    filed: "已开单",
    open: "打开工单",
    yours: "按你的描述开一张文档类工单。",
  },

  ticket: {
    owner: "执行",
    verifier: "验证",
    source: "来源",
    budget: "预算",
    rounds: "打回",
    roundsOf: (used: number, limit: number): string => `${used} / ${limit} 轮`,
    spentOf: (spent: string, budget: string): string => `${spent} / ${budget}`,
    tabs: { record: "工单", workbench: "验收台", runs: "运行记录" },
    returned: (n: number): string => `打回 ${n} 次`,
    dropped: "这张工单已停。",
    goal: "目标",
    criteria: "验收标准",
    review: "审查意见",
    reviewEmpty: "还没有审查意见。",
    round: (n: number): string => `第 ${n} 轮`,
    verifierSays: "验证者",
    youSaid: "你",
    onParagraph: (n: number): string => `第 ${n} 段`,
    decisions: "拍板记录",
    decisionsEmpty: "还没有拍过板。",
    result: "结果",
    resultPending: "还没交付。",
    filedToHandbook: "已写进手册",
  },

  decision: {
    ask: (option: string): string => `回答：${option}`,
    halt: {
      more: "加额度继续",
      decide: "我来拍板",
      stop: "停掉",
    } satisfies Record<HaltChoice, string>,
    accept: "验收通过",
    acceptWith: (action: string): string => `验收通过并批准：${action}`,
    sendBack: "打回重做",
    proposalYes: "采纳提议",
    proposalNo: "不采纳",
    drop: "停掉工单",
  },

  needs: {
    askTitle: "卡点：需要你定",
    askField: "你的决定",
    noteField: "补一句（可选）",
    notePlaceholder: "留空则只按选项执行",
    fileField: "写进组织手册，下次同类问题照此办",
    submit: "提交并回写工单",
    haltBudgetTitle: "预算熔断",
    haltBudget: (spent: string, next: string, budget: string): string =>
      `已花 ${spent}，下一步预计 ${next}，会超过本单 ${budget} 的上限。服务端拦下了这一步。`,
    haltRoundsTitle: "轮次熔断",
    haltRounds: (limit: number): string =>
      `验证者第 ${limit + 1} 次要打回，超过了 ${limit} 轮的上限。服务端拦下了这次打回，没有再跑。`,
    disagreement: "分歧",
    moreBudget: (budget: string): string => `预算加到 ${budget}`,
    moreRound: "再给一轮",
    decide: "我来拍板",
    stop: "停掉",
    decideTitle: "验证已通过，等你验收",
    decideLine: "验证者已对照验收标准放行。在验收台看完再拍板。",
    openWorkbench: "打开验收台",
    approve: {
      merge: "批准并合并 PR",
      publish: "批准并发布",
      reply: "都发完了，结单",
      email: "复核并发送",
      experiment: "复核并开跑",
    } satisfies Record<OutwardAction, string>,
    acceptOnly: "验收通过",
    reviewCheck: "我已看过要发出的内容，以及它花多少钱、对谁有约束",
    draftLine: "草稿不会自动发出。点「打开预填」在对应网站打开填好的回复框，你改完自己发。",
    sendBack: "打回",
    sendBackPlaceholder: "说清楚要改什么，这句话会记成执行者的一条教训",
    sendBackSubmit: "打回重做",
    cancel: "取消",
    proposalTitle: "主理的提议",
    adopt: "采纳",
    decline: "不用",
  },

  workbench: {
    empty: "还没有交付物：执行者交付、验证者放行后会出现在这里。",
    verifiedBy: "验证者已放行",
    notVerified: "还没经过验证，不能验收",
    code: {
      pr: (n: number, branch: string): string => `PR #${n} · ${branch}`,
      checks: "检查",
      checkCi: "CI 全绿（macOS / Windows / Linux）",
      checkTests: "新增测试先失败后通过",
      checkVerifier: "验证者用只读令牌复跑一遍",
      newFile: "新文件",
    },
    experiment: {
      chart: "评测准确率（按提示词调整轮次）",
      round: "轮次",
      accuracy: "准确率",
      current: "现用模型",
      candidate: "候选：总体",
      longDocs: "候选：长文档",
      metric: "指标",
      currentModel: "现用",
      candidateModel: "候选",
      overall: "总体准确率",
      long: "长文档准确率",
      cost: "每千次调用",
      reproduced: "验证者换一组随机种子复现，差异在 0.3 分以内。",
      interim: (n: number) => `中途结果：前 ${n} 轮跑完了，还没交付验证。`,
    },
    document: {
      version: "版本",
      comments: "批注",
      resolved: "已在下一版处理",
      comment: "批注",
      commentPlaceholder: "写下对这一段的意见，提交后打回重写",
      commentSubmit: "批注并打回",
      revised: "按你的批注改过",
      generic: [
        "按你的描述完成了初稿，结构是：背景、做法、结论。",
        "所有引用都附了来源，数字都核对过原始数据。",
        "验证者逐段对照验收标准检查过，没有遗留问题。",
      ],
    },
    ledger: {
      item: "条目",
      text: "原文",
      risk: "风险",
      note: "说明",
      risks: { ok: "可接受", watch: "需留意", block: "须修改" },
      draft: "修订意见邮件",
      to: "收件人",
      subject: "主题",
    },
    outreach: {
      open: "打开预填",
      opened: "已打开",
      original: "原帖",
      reply: "回复草稿",
      email: "邮件草稿",
      to: "收件人",
      subject: "主题",
      toast: (where: string): string => `示意：会在 ${where} 打开填好的回复框，由你改完发出`,
    },
  },

  runs: {
    bill: "账单",
    who: "成员",
    step: "步骤",
    model: "模型",
    tokens: "Token",
    cache: "缓存命中",
    cost: "花费",
    total: "合计",
    empty: "还没有运行。",
    steps: { work: "执行", deliver: "交付", fail: "验证·打回", pass: "验证·放行", ask: "提问" },
    log: "执行日志",
    logMeta: (n: number): string => `${n} 次工具调用 · 默认折叠`,
    logLine: (step: string, tools: number): string => `${step}：${tools} 次工具调用`,
    logNote: "工具调用全链路记在 Trace 里，工单主视图只留需求、审查意见和结果。",
  },

  team: {
    title: "团队",
    info: "每名成员 = 角色 + 机器 + 模型 + 权限，可以整套导出成组织模板包，换机或分享时一键导入。",
    export: "导出模板包",
    exported: "已导出 floe-studio.penguin-org（角色、机器、权限与规则）",
    import: "导入模板包",
    imported: "示意：导入会先出一份差异清单，确认后才替换",
    machine: "机器",
    model: "模型",
    perms: "权限",
    skill: (v: number): string => `Skill v${v}`,
    metrics: (first: number, verified: number, rework: number, cost: string): string =>
      `一次通过 ${first}/${verified} · 返工 ${rework} 次 · 单张 ${cost}`,
    noMetrics: "还没有验证过的工单",
    channel: "执行通道：PenguinHarness 原生工具链",
    channelNote:
      "扩展方向：让个别岗位按需走 Claude Code、Codex 等外部 CLI，目前只有通过 SSH 操控 Claude Code 的 use-claude-code 插件。",
    spent: (usd: string): string => `本月 ${usd}`,
  },

  rules: {
    title: "规则",
    info: "这些规则写在 org/how-we-work.md 里，服务端按它们拦截；改动会记进历史。",
    flow: "状态机",
    flowNote: "每个状态绑定一个接手方。验证不通过自动打回执行；只有卡点、熔断和待拍板进收件箱。",
    gates: "硬门禁",
    budget: "单张工单预算",
    rounds: "打回轮次上限",
    depth: (n: number): string => `委派深度上限 ${n} 层，服务端拒绝循环委派`,
    verified: "未经独立验证的交付不会进你的收件箱",
    outward: "对外动作分级",
    outwardNote: "组织之外的一切动作都先进收件箱。分级决定你要怎么批。",
    triggers: "触发",
    triggersNote: "事件一到立即唤醒主理开单，不等巡检；巡检和复盘按时间表跑。",
    notNow: "不做的事",
    notNowItems: [
      "没有全员大群聊：成员之间的交接都在工单里。",
      "不凑组织架构图：没有 CEO、HR、VP。",
      "不做黑盒：模型、技能、权限和运行记录都是 Project 里的文件。",
    ],
  },

  handbook: {
    title: "手册与技能",
    info: "拍板结论、打回教训和每名成员的私有 Skill 都是本地文件，改前自动快照，随时可回滚。",
    decisions: "拍板结论",
    decisionsEmpty: "在决策卡里勾选「写进组织手册」，结论会出现在这里。",
    lessons: "打回教训",
    lessonsEmpty: "验证者或你打回一次，就记一条教训。",
    skills: "成员 Skill",
    current: "当前",
    snapshot: "快照",
    rollback: "回滚到此版",
    forward: "切回此版",
    base: "初始版本",
    files: "文件",
    from: (title: string): string => `来自：${title}`,
    lessonBy: (who: string): string => `写进 ${who} 的 Skill`,
  },

  review: {
    title: "复盘与评测",
    info: "内环：主理按一次通过率、返工次数和单工单花费定期复盘，主动提流程优化工单。外环：在社区公开评测上和别的组织模板比。",
    inner: "内环 · 本地复盘",
    run: "现在复盘",
    last: (n: number): string => `已复盘 ${n} 次 · 每周五自动跑`,
    member: "成员",
    firstPass: "一次通过率",
    rework: "返工次数",
    perTicket: "单工单花费",
    proposals: "主理的提议",
    proposalsEmpty: "这次没有新提议。",
    outer: "外环 · 社区评测",
    outerNote:
      "依托 Shared RSI Community（club.penguin.ooo）的开放评测：把典型团队交付场景做成公开 Benchmark，组织模板、协作规矩和模型组合一起跑分。下表是示意数据。",
    template: "组织模板",
    staffing: "编制",
    models: "模型组合",
    score: "得分",
    yours: "你的组织",
    submit: "提交匿名跑分",
    submitted: "已提交，等社区评测排期",
    rows: [
      {
        template: "开源维护 · 精简",
        staffing: "1 + 2 + 1",
        models: "GLM-5.3 / MiniMax M3",
        firstPass: "71%",
        perTicket: "$1.40",
        score: "82.4",
      },
      {
        template: "科研流水线",
        staffing: "1 + 3 + 1",
        models: "Qwen3.8 Max / DeepSeek V4 Pro",
        firstPass: "64%",
        perTicket: "$3.10",
        score: "79.0",
      },
      {
        template: "大公司全编制",
        staffing: "1 + 8 + 2",
        models: "混合",
        firstPass: "58%",
        perTicket: "$6.80",
        score: "70.3",
      },
    ],
  },

  tour: {
    open: (done: number, total: number): string => `体验清单 ${done}/${total}`,
    title: "体验清单",
    onboarding: "开局",
    daily: "日常",
    items: {
      pick: "挑一张起步卡，或直接说目标",
      answer: "在 A2UI 表单里答开局三问",
      edit: "在组织清单里改一项（活、模型或门禁）",
      create: "点「确认并开始创建」",
      ask: "在卡点的决策卡里选一项并提交（评测摘要那张）",
      accept: "在验收台看完交付，验收通过",
      outward: "批准一个对外动作，或打开一份预填草稿",
      halt: "处理一次熔断（经销商协议或发票核对）",
      autoReturn: "让时间过去，看验证者自动打回",
      sendBack: "在验收台打回一次，或给文档某段批注",
      event: "让时间过去，看 GitHub Issue 自动开单",
      trace: "打开「运行记录」，看账单和折叠的执行日志",
      request: "跟主理提个新需求并确认开单",
      rollback: "在手册里把某名成员的 Skill 回滚一版",
      review: "在复盘页点「现在复盘」，看主理的优化提议",
    } satisfies Record<TourItem, string>,
    restart: "重新开始",
    switchTo: { onboarding: "从开局体验", daily: "直接看日常" },
  },

  pass: {
    hint: "原型里没有真的 Agent 在跑。点一下，所有工单各走一步。",
    button: "让时间过去",
    nothing: "没有能动的工单：剩下的都在等你。",
    events: {
      arrived: (title: string): string => `新事件，主理已开单：${title}`,
      delivered: (title: string): string => `已交付，转给验证者：${title}`,
      returned: (title: string): string => `验证未通过，已自动打回：${title}`,
      passed: (title: string): string => `验证通过，等你验收：${title}`,
      asked: (title: string): string => `卡点，等你回答：${title}`,
      halted: (title: string): string => `熔断，等你定：${title}`,
    },
  },

  money: (usd: number): string => `$${usd.toFixed(2)}`,
  tokens: (n: number): string =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`,

  tickets: {
    exportFix: {
      title: "修复导出 Markdown 时中文文件名乱码（#198）",
      goal: "有用户反馈，导出带中文标题的笔记时，生成的 .md 文件名是乱码。修好导出路径的编码并补上测试。",
      criteria: [
        "macOS、Windows、Linux 上导出的文件名都与标题一致",
        "新增覆盖中文、日文和 emoji 标题的单测",
        "不改动导出内容本身",
      ],
      findings: [
        "Windows 上拿到的是 NFD 分解形式，「é」这类字符仍会被拆开；请统一做 NFC 规范化，并替换 Windows 不允许的字符。",
      ],
      lessons: ["处理文件名前先做 Unicode NFC 规范化，并单独在 Windows 路径上跑一次测试。"],
      result: "导出前统一做 NFC 规范化，并替换文件名里的非法字符。三平台 CI 全绿，新增 5 个单测。",
    },
    evalSummary: {
      title: "评测：把摘要功能换成开源模型",
      goal: "摘要功能现在每千次调用花 $1.84。评测 DeepSeek V4 Flash 能否在差距 1 分以内接手。",
      criteria: [
        "在 400 条标注集上对比准确率",
        "长文档（超过 8 千字）单独报告",
        "给出每千次调用的成本",
      ],
      ask: {
        question: "候选模型在长文档上低了 3 分，提示词还在调。怎么确认？",
        context: "前两轮只跑了 100 条抽样。",
        options: {
          subset: { label: "只跑长文档子集", description: "约 $1.2，在本单预算内" },
          full: { label: "跑全量评测", description: "约 $18，超出本单预算，算一次大实验" },
          stop: { label: "先停，维持现状", description: "关掉这张单" },
        },
      },
      result:
        "调了 6 轮提示词后，候选模型总体 80.6 分，比现用模型低 0.6 分；长文档 77.9 分。每千次调用从 $1.84 降到 $0.31。",
    },
    releasePost: {
      title: "v2.0 发布文章",
      goal: "写 v2.0 的发布文章，讲清多端同步、离线模式和新的插件接口。",
      criteria: [
        "每个新功能配一段能照着做的说明",
        "所有链接能打开，版本号与发布说明一致",
        "1500 字以内",
      ],
      findings: ["第 3 段说同步「完全实时」，实际是 5 秒合并一次；第 4 段的插件文档链接打不开。"],
      lessons: ["写功能描述前先对照代码和发布说明核实行为；每个链接都实际打开一遍。"],
      result: "第二版改正了同步描述和插件文档链接，全文 1120 字。",
    },
    resellerTerms: {
      title: "审阅经销商协议（北辰软件）",
      goal: "北辰软件想代理 Floe Pro，发来了协议。审阅后标出风险条款，拟一份修订意见。",
      criteria: [
        "每条风险条款给出原文、风险和改法",
        "赔偿、数据、终止三类条款必须覆盖",
        "修订意见能直接发给对方",
      ],
      findings: [
        "第 7 条赔偿责任没有上限，修订意见里漏了。",
        "第 9 条要我们把用户数据交给经销商，和隐私政策冲突。",
        "第 7 条：执行者把上限定为 12 个月费用，我认为应是已付费用总额。两边仍未达成一致。",
      ],
      lessons: [
        "审合同先按赔偿、数据、终止三类过一遍清单，再看其他条款。",
        "涉及用户数据的条款，先对照隐私政策原文。",
        "赔偿上限有两种常见写法时，把两种都列出来交给人定。",
      ],
      result:
        "9 条条款里标出 4 条风险，修订意见邮件已拟好。第 7 条的赔偿上限，执行者与验证者意见不同。",
    },
    replies: {
      title: "回复社区里 3 条求助帖",
      goal: "每日巡检在 X、论坛和 Reddit 上找到 3 条关于 Floe 的求助。按作者的情况写回复草稿，不代发。",
      criteria: ["先解决问题，再给链接", "语言和原帖一致", "一条都不自动发出"],
      result: "3 条回复草稿已就绪。",
    },
    lintRule: {
      title: "提议：开发提交前先跑 lint 和相关单测",
      goal: "上周开发有 2 张单因格式问题和漏跑测试被打回，每次多花约 $0.6。提议把「提交前先跑 pnpm lint 和相关单测」写进开发的 Skill。",
      criteria: ["写进巴布亚企鹅的 Skill，改前自动快照", "下周复盘对比一次通过率"],
      result: "已写进开发的 Skill。",
    },
    syncDup: {
      title: "同步时偶发重复笔记（#212）",
      goal: "两台设备离线编辑同一篇笔记，重新联网后偶尔会出现两份。找到原因并修复。",
      criteria: ["先有一个能稳定复现的失败测试", "冲突时仍保留两边版本供挑选", "不拖慢正常同步"],
      findings: ["修复只处理了两台设备，三台设备同时改仍会重复；测试也只覆盖了两台。"],
      lessons: ["并发类修复按 N 台设备写测试，不要只测两台。"],
      result: "按笔记 ID 合并，冲突时调用 resolve 保留两边；三台设备的并发测试通过。",
    },
    apiDocs: {
      title: "补全插件 API 文档",
      goal: "插件接口的 12 个方法里有 5 个没有文档。补齐签名、参数说明和例子。",
      criteria: ["5 个方法都有签名、参数和返回值说明", "每个方法一段能运行的例子"],
      result: "5 个方法的文档已补齐，每个带一段能运行的例子。",
    },
    invoices: {
      title: "核对 11 月发票与收入",
      goal: "把 Stripe 上 11 月的收入和开出的发票对一遍，标出对不上的。",
      criteria: ["逐笔对上金额和日期", "对不上的写明原因和处理建议"],
      result: "核对 214 笔收入，3 笔对不上：2 笔退款没冲红，1 笔重复开票。",
    },
    ciCache: {
      title: "CI 缓存命中率低，构建慢了一倍",
      goal: "CI 构建从 6 分钟涨到 14 分钟。查清缓存为什么失效。",
      criteria: ["构建回到 7 分钟以内", "说明每个缓存的键"],
      findings: ["只修了 pnpm 缓存；Playwright 浏览器缓存的键里带着日期，每天都会失效。"],
      lessons: ["改缓存键前先列出所有缓存，逐个确认键里没有每天都变的东西。"],
      result: "构建时间回到 6 分钟。",
    },
    guide: {
      title: "写新用户上手指南",
      goal: "给第一次打开 Floe 的人写一页上手指南。",
      criteria: ["五分钟内能读完", "每一步配截图"],
      result: "上手指南已发布。",
      ruled: "面向用户的文档一律用第二人称和短句，不写营销腔。",
    },
    discount: {
      title: "评估年付打八折的影响",
      goal: "估一下年付打八折对收入的影响。",
      criteria: ["给出三种情形下的收入估计"],
      result: "",
      ruled: "不做降价促销；年付维持原价，改为多送 2 个月。",
    },
    installWin: {
      title: "Windows 上安装失败（#215）",
      goal: "有用户在 Windows 11 上安装 2.0 时，报错「缺少 VCRUNTIME140.dll」。",
      criteria: ["干净的 Windows 11 虚拟机上能装好", "安装包不超过原来的 1.2 倍"],
      result: "安装前检测并静默安装 VC++ 运行库。",
    },
    proInquiry: {
      title: "回复 Pro 年付询价（Northwind）",
      goal: "客户来信问 10 人团队的 Pro 年付价格和开票方式。拟一封回复，不代发。",
      criteria: ["报价与定价页一致", "说明开票方式和付款周期"],
      result: "回复草稿已拟好，报价按定价页，并说明可以开增值税发票。",
    },
    pricing: {
      title: "调研三家竞品的定价，写成对比",
      goal: "调研三家同类笔记应用的定价和团队版条款，写成一页对比。",
      criteria: ["价格注明查询日期和来源", "列出团队版的人数门槛"],
      result: "三家竞品的定价对比已写好，每个价格都附了来源和查询日期。",
    },
    tutorial: {
      title: "写一篇插件入门教程",
      goal: "写一篇插件入门教程：从零写一个「插入今天日期」的命令。",
      criteria: ["照着做 15 分钟内能跑起来", "代码用 2.0 的 API"],
      findings: ["示例代码用的是 1.x 的 API，2.0 里 registerCommand 已改名为 commands.add。"],
      lessons: ["写示例代码前先在当前版本上跑一遍。"],
      result: "教程已写好，示例代码在 2.0 上验证过。",
    },
    cheaperModel: {
      title: "提议：台账核对换用 DeepSeek V4 Flash",
      goal: "王企鹅的台账类工单平均每张 $1.9，其中八成花在逐行比对上，用不到强推理。提议这类活换用 DeepSeek V4 Flash，预计每张降到 $0.5。",
      criteria: ["只改王企鹅的模型", "下次复盘对比一次通过率，变差就换回"],
      result: "王企鹅已换用 DeepSeek V4 Flash。",
    },
  } satisfies Record<FixtureId, TicketWords>,

  docs: {
    releasePost: {
      versions: [
        [
          "Floe 2.0 今天发布。这一版做了四个月，把大家呼声最高的三件事做完了：多端同步、离线模式，以及一套全新的插件接口。",
          "多端同步：在手机上记下的笔记，回到电脑前就已经在那里了。两边同时改了同一篇时，Floe 会保留两个版本，让你自己挑。",
          "同步完全实时，任何改动都会立刻出现在所有设备上。",
          "插件接口：现在可以用 TypeScript 写插件，读写笔记、注册命令。文档见 floe.dev/plugins/v2。",
          "升级只要在设置里点一下「检查更新」，旧数据会自动迁移。",
        ],
        [
          "Floe 2.0 今天发布。这一版做了四个月，把大家呼声最高的三件事做完了：多端同步、离线模式，以及一套全新的插件接口。",
          "多端同步：在手机上记下的笔记，回到电脑前就已经在那里了。两边同时改了同一篇时，Floe 会保留两个版本，让你自己挑。",
          "改动会在 5 秒内合并并推送到其他设备；离线时的改动会在重新联网后补上。",
          "插件接口：现在可以用 TypeScript 写插件，读写笔记、注册命令。文档见 floe.dev/docs/plugins。",
          "升级只要在设置里点一下「检查更新」，旧数据会自动迁移。",
        ],
      ],
      comments: [
        { version: 1, paragraph: 2, text: "「完全实时」不对：代码里是每 5 秒合并一次。" },
        { version: 1, paragraph: 3, text: "这个链接打不开，文档在 floe.dev/docs/plugins。" },
      ],
    },
  } satisfies Partial<Record<FixtureId, DocWords>>,

  ledger: {
    resellerTerms: [
      {
        item: "第 3 条 授权地域",
        text: "乙方在大中华区独家经销，期限 3 年。",
        risk: "watch",
        note: "独家期偏长，建议 1 年，并设业绩门槛。",
      },
      {
        item: "第 7 条 赔偿责任",
        text: "甲方承担因产品缺陷造成的全部损失。",
        risk: "block",
        note: "没有上限。执行者：上限为 12 个月费用；验证者：上限为已付费用总额。",
      },
      {
        item: "第 9 条 用户数据",
        text: "甲方应向乙方提供终端用户数据。",
        risk: "block",
        note: "与隐私政策冲突，建议删除。",
      },
      { item: "第 12 条 终止", text: "任一方提前 30 天书面通知即可终止。", risk: "ok", note: "" },
      { item: "第 15 条 价格调整", text: "甲方每年调价不超过 5%。", risk: "ok", note: "" },
    ],
    invoices: [
      {
        item: "ch_3P…a91",
        text: "11-04 · $96.00 · 已退款",
        risk: "block",
        note: "退款后发票没有冲红，建议开红字发票。",
      },
      { item: "ch_3P…c07", text: "11-12 · $240.00 · 已退款", risk: "block", note: "同上。" },
      {
        item: "in_1Q…f3e",
        text: "11-19 · $48.00 · 开票两次",
        risk: "watch",
        note: "同一笔收入开了两张发票，作废后一张。",
      },
      { item: "其余 211 笔", text: "金额与日期一致", risk: "ok", note: "" },
    ],
  } satisfies Partial<Record<FixtureId, LedgerRow[]>>,

  mail: {
    resellerTerms: {
      subject: "关于经销协议的修订意见",
      body: "王经理您好：\n\n协议我们看过了，整体没问题，有四处想调整：第 3 条独家期改为 1 年并设业绩门槛；第 7 条赔偿责任设上限；第 9 条删除；其余条款同意。修订稿见附件。\n\n浮冰工作室",
    },
    proInquiry: {
      subject: "Re: Floe Pro 年付报价",
      body: "Lena 你好：\n\n10 人团队的 Pro 年付是每人每月 $8，按年付共 $960，比月付省两个月。可以开增值税发票，付款后 3 个工作日内寄出。\n\n需要的话我们可以先开 14 天试用。\n\n浮冰工作室",
    },
  } satisfies Partial<Record<FixtureId, { subject: string; body: string }>>,

  drafts: {
    replies: [
      {
        where: "X",
        author: "@mika_notes",
        post: "Floe 同步老是卡在 99%，有人遇到吗？",
        draft:
          "卡在 99% 多半是有一个超大附件。2.0 里可以在 设置 → 同步 里跳过 50MB 以上的附件。还不行的话发一下日志，我们看看。",
      },
      {
        where: "论坛",
        author: "kenji",
        post: "Is there a way to export all notes at once?",
        draft: "Yes: File → Export → All notes. Since 2.0 it keeps your folder structure, too.",
      },
      {
        where: "Reddit",
        author: "u/quietdesk",
        post: "Floe vs. a wiki for a five-person team?",
        draft:
          "For five people, Floe's shared folders cover most of what a wiki does, and notes work offline. If you need page-level permissions, a wiki is still the better fit.",
      },
    ],
  } satisfies Partial<Record<FixtureId, Draft[]>>,
};

/** The dictionary's shape; the sample work's sections are read by any fixture id. */
export type Words = Omit<typeof zh, "tickets" | "docs" | "ledger" | "mail" | "drafts"> & {
  tickets: Record<FixtureId, TicketWords>;
  docs: Partial<Record<FixtureId, DocWords>>;
  ledger: Partial<Record<FixtureId, LedgerRow[]>>;
  mail: Partial<Record<FixtureId, { subject: string; body: string }>>;
  drafts: Partial<Record<FixtureId, Draft[]>>;
};
