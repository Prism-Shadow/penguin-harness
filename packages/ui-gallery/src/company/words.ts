/**
 * The company-mode prototype's own words, in Chinese; `words-en.ts` holds the English, held to
 * the same shape by `Words`. Labels the shipped company mode already has (the page names, the
 * ticket's section titles, the board's columns) are read from the Web App's dictionary instead,
 * so the prototype says them as the app does. `tickets` is keyed by fixtures.ts.
 */
import type { FixtureId } from "./fixtures";

export interface TicketWords {
  title: string;
  /** One line: what it is and why it exists. */
  gist: string;
  acceptance: readonly string[];
  progress: readonly string[];
  question?: string;
  options?: readonly { label: string; hint: string }[];
  result?: string;
}

export const zh = {
  org: {
    name: "Harness 维护组",
    mission: "照看 penguin-harness 代码库：发现问题、修复缺陷，让新用户顺利完成首次配置。",
  },
  nav: {
    inbox: "收件箱",
    lead: "主理",
    more: "更多页面",
    less: "收起",
    team: "团队",
    sessions: "工作会话",
    sessionsEmpty: "没有正在运行的工作会话",
    sessionOf: (n: number) => `会话 ${n}`,
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
      duties: "接你的话，记成工单，派给合适的人；提议日程和招人。自己不写代码。",
    },
    engineer: { name: "沈知远", title: "工程师", duties: "写代码、修缺陷，交付 PR，附带测试。" },
    verifier: {
      name: "林清越",
      title: "验证工程师",
      duties: "把每份交付实际跑一遍再交给你验收；也负责复现问题。",
    },
  },
  sources: { person: "你说的", patrol: "每日巡检", lead: "主理提议" },
  waits: { accept: "待接受", answer: "待回答", review: "待验收" },
  views: { waiting: "等你", working: "进行中", later: "稍后", handled: "已处理", archived: "归档" },
  inbox: {
    title: "收件箱",
    info: "工单只在三种时候出现在「等你」里：等你接受、等你回答、等你验收。其余时间它在「进行中」，不用看。",
    talk: "和主理说",
    summary: (working: number, spent: string, budget: string) =>
      `${working} 张进行中，本周期已用 ${spent} / ${budget}`,
    empty: {
      waiting: "没有等你的工单",
      working: "没有进行中的工单",
      later: "没有稍后处理的工单",
      handled: "还没有处理完的工单",
      archived: "没有归档的工单",
    },
    unread: "未读",
    schedules: "日程",
    schedulesEmpty: "还没有日程。主理提议的日程，接受后出现在这里。",
  },
  ticket: {
    needsYou: "需要你",
    asks: { accept: "要不要做这件事？", review: "结果符合你的预期吗？" },
    kindNotes: {
      task: "接受后开一个工作会话。它写进展，有问题才来找你。",
      schedule: "接受后，这个日程每天把发现的问题提成工单，由你逐张决定。",
      role: "接受后，这个角色出现在工单的署名里。",
    },
    accept: "接受",
    reject: "驳回",
    answer: "回答",
    /** An option's label when it is the one the session recommends. */
    recommended: (label: string) => `${label}（推荐）`,
    notePlaceholder: "要补充的话可以写在这里，留空也可以",
    approve: "验收通过",
    sendBack: "打回",
    sendBackPlaceholder: "写下要改什么，然后打回",
    deliverable: "交付物",
    source: "来源",
    decisions: "决定",
    returned: "打回",
    sessionsEmpty: "还没有工作会话。接受后开一个。",
    /** A session's row on the ticket: who works in it and how long it is. */
    sessionRow: (n: number, owner: string, messages: number) =>
      `会话 ${n} · ${owner} · ${messages} 条消息`,
    saidInSession: "你在会话里说：",
    later: "稍后",
    archive: "归档",
    restore: "移回收件箱",
    waitingFirst: "这张工单在等你，先处理它才能稍后或归档。",
    saidGoal: "你对主理说的原话。",
    saidProgress: "读了相关代码，开始动手。",
    saidResult: "做完了，等你验收。",
    reworkProgress: "按打回的意见修改完了。",
  },
  lead: {
    title: "主理",
    info: "常驻的 Agent。你说的事它记成工单，交给工作会话去做，自己不干活。",
    placeholder: "告诉主理要做什么，Enter 发送",
    send: "发送",
    empty: "还没有对话。告诉主理要做什么，它会记成工单。",
    lines: {
      proposals: "我先提三件事，都在收件箱里。你逐张接受或驳回，接受的才会开始。",
      filed: "记成工单了，已经开了工作会话。有问题或做完时，它会出现在收件箱里。",
    },
  },
  setup: {
    title: "让它照看什么？",
    body: "说一句你关心的事。主理会回几张提议工单，你逐张决定，没有长提案，也没有群聊。",
    placeholder: "比如：照看 penguin-harness 代码库，发现问题、修复缺陷",
    start: "开始",
    examples: [
      "照看 penguin-harness 代码库：发现问题、修复缺陷",
      "每天整理新 issue，能修的直接修",
      "让新用户顺利完成首次配置",
    ],
    examplesLabel: "示例",
  },
  team: {
    title: "团队",
    info: "员工是长期的角色：名字、职位、职责和预算。只有主理常驻；其他人只在自己负责的工单的工作会话里干活。",
    hire: "招人",
    hireHint: "招人、调整职责或预算，都对主理说，它会提一张工单给你决定。",
    reportsTo: (name: string) => `向${name}汇报`,
    standing: "常驻",
    spend: (spent: string, budget: string) => `本月 ${spent} / ${budget}`,
    working: "在做",
    idle: "眼下没有在做的工单",
    done: (n: number) => `做完 ${n} 张`,
    pending: "待加入",
    pendingNote: "提议已在收件箱，接受后加入。",
  },
  session: {
    info: "这是 Agent 干这张工单时的对话。工单上只记它写回来的结论；想看过程或者直接交代，在这里说。",
    ticket: "工单",
    status: { running: "运行中", ended: "已结束" },
    brief: "主理把这张工单交给了这个会话。",
    answered: (label: string) => `选「${label}」。`,
    sentBack: (note: string) => `打回：${note}`,
    noted: "收到，这句话我也记进工单了。",
    waitingAnswer: "这个会话停在问题上，等你回答。",
    waitingReview: "做完了，等你验收。",
    ended: "这个会话已经结束。工单的结论在工单里。",
    placeholder: "直接和这个会话说，Enter 发送",
    send: "发送",
  },
  schedule: {
    info: "日程是工单的来源之一。新日程只提议；你信得过它之后，可以让它提出的工单直接开工。",
    daily: "每天 09:00",
    auto: "提出的工单直接开工",
    autoOn: "直接开工",
    autoOff: "只提议",
  },
  pass: {
    button: "让时间过去",
    hint: "原型里没有 Agent 在运行。点一下，每个工作会话前进一步。",
    nothing: "没有新的动静：所有工单都在等你，或者已经做完。",
    events: {
      progress: (title: string) => `「${title}」有新进展`,
      asked: (title: string) => `「${title}」有一个问题等你回答`,
      delivered: (title: string) => `「${title}」做完了，等你验收`,
      proposed: (title: string) => `巡检提议：「${title}」`,
      started: (title: string) => `巡检发现并已开工：「${title}」`,
    },
  },
  kept: {
    title: "这一页沿用现有设计",
    body: "这次的规格没有改动它，所以原型里没有重画。",
  },
  tickets: {
    csv: {
      title: "给导出加上 CSV",
      gist: "导出页除了 JSON，还能导出 CSV。",
      acceptance: ["十万行的导出不超时", "现有的 JSON 导出不变"],
      progress: ["读完导出模块，有两种做法。", "按你的决定实现完了，十万行用时 1.8 秒。"],
      question: "大文件导出：流式写出，还是一次生成？",
      options: [
        { label: "流式写出", hint: "内存占用平稳，实现多一层" },
        { label: "一次生成", hint: "实现简单，十万行以上可能超时" },
      ],
      result: "CSV 导出已实现，带回归测试。",
    },
    connection: {
      title: "首次配置时增加连接测试",
      gist: "填完 API key 后，可以一键测试连接。",
      acceptance: ["密钥无效、网络不通、模型不存在，各有一句提示", "不保存也能测试"],
      progress: ["在模型对话框里加了「测试连接」按钮。", "三种失败各有一句提示，补了测试。"],
      result: "连接测试已加，三种失败各有提示。",
    },
    flaky: {
      title: "修复偶发失败的导出测试",
      gist: "导出测试在 CI 上偶发超时，最近 20 次里失败了 3 次。",
      acceptance: ["连续跑 50 次不失败"],
      progress: ["复现了：导出大文件时，测试等待的超时太短。"],
      result: "超时改为按文件大小计算，连续 50 次通过。",
    },
    jitter: {
      title: "复现窗口缩放时的侧栏抖动",
      gist: "在 1024 宽度附近拖动窗口，侧栏来回折叠。",
      acceptance: ["给出稳定的复现步骤", "指出是哪个断点"],
      progress: ["在 1020 到 1028 之间稳定复现。", "原因是两个断点用了不同的取整。"],
      result: "复现步骤和原因写在报告里，修复另开工单。",
    },
    types: {
      title: "升级 @types/node",
      gist: "跟上 Node 24 的类型。",
      acceptance: ["类型检查通过"],
      progress: ["升级完了，改了 4 处类型。"],
      result: "已升级，类型检查通过。",
    },
    docs: {
      title: "修正快速开始里的端口号",
      gist: "文档写的是 7364，开发模式实际是 7365。",
      acceptance: ["两种语言都改"],
      progress: ["中英两页都改了。"],
      result: "两页都已修正。",
    },
    timeout: {
      title: "给模型请求加上超时提示",
      gist: "请求超过 60 秒没有回应时，界面什么都不说。",
      acceptance: ["超时后有一句提示和重试按钮"],
      progress: ["加了提示和重试按钮。"],
      result: "超时提示已加。",
    },
    lint: {
      title: "清理 12 处未使用的导入",
      gist: "巡检发现 lint 有 12 条未使用导入的警告。",
      acceptance: ["lint 没有警告"],
      progress: ["12 处都删掉了。"],
      result: "lint 没有警告了。",
    },
    survey: {
      title: "摸清代码库现状",
      gist: "读一遍代码库、近期的 issue 和 CI，写一页现状。",
      acceptance: ["一页以内", "列出最值得先做的三件事"],
      progress: ["读完了近 30 天的 issue 和 CI 记录。", "现状写好了，列了三件最值得先做的事。"],
      result: "现状写成一页，放在手册里。",
    },
    patrol: {
      title: "每日巡检：每天 09:00 看新 issue 和 CI",
      gist: "每天看一遍新 issue 和 CI 结果，把发现的问题提成工单。",
      acceptance: ["起初只提议，做不做由你决定"],
      progress: [],
    },
    verifier: {
      title: "加一名专职验证",
      gist: "每张交付先由另一个 Agent 实际操作一遍，再交给你验收。",
      acceptance: ["写代码的和验证的不是同一个 Agent"],
      progress: [],
    },
  } satisfies Record<FixtureId, TicketWords>,
};

export type Words = typeof zh;
