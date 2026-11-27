import { IDS } from "../app/mock/ids";
import type { Lang } from "./frame";
import type { Member, Notes, Org, Ticket } from "./model";

export const LEAD_SESSION = `/chat/${IDS.sessions.orgDesk}`;

export const REVIEW_APP = `/apps?app=${IDS.agents.docs}/citation-check`;

export function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function demoNotes(lang: Lang): Notes {
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
  return {
    now: L("刚刚", "just now"),
    decided: (answer) => L(`你拍板：${answer}`, `You decided: ${answer}`),
    accepted: L("你接受了交付", "You accepted the delivery"),
    sentBack: (note) => L(`你打回：${note}`, `You sent it back: ${note}`),
    resumed: L("你放行了熔断，继续执行", "You lifted the breaker; work resumes"),
    stopped: L("你停止了工单", "You stopped the ticket"),
    stoppedOutcome: L("已停止，未交付", "Stopped, nothing delivered"),
    acceptedOutcome: L("已验收", "Accepted"),
  };
}

function members(lang: Lang): Member[] {
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
  return [
    {
      id: "lead",
      name: L("主理", "Lead"),
      role: "lead",
      duty: L(
        "和你对齐目标，拆单、派单、复盘",
        "Settles goals with you, splits and assigns work, reviews",
      ),
      model: "DeepSeek V4 Pro",
      machine: L("本机", "This machine"),
      skill: "company-ceo",
      skillVersion: 5,
    },
    {
      id: "writer",
      name: L("写作", "Writer"),
      role: "executor",
      duty: L("改文档、写更新说明", "Edits the docs, writes release notes"),
      model: "DeepSeek V4.1 Flash",
      machine: L("本机", "This machine"),
      skill: "docs-writing",
      skillVersion: 4,
    },
    {
      id: "runner",
      name: L("示例", "Examples"),
      role: "executor",
      duty: L("跑通文档里的命令和代码示例", "Runs the commands and code samples in the docs"),
      model: "GLM-5",
      machine: "gpu-box-a8f3c2",
      skill: "docs-examples",
      skillVersion: 3,
    },
    {
      id: "checker",
      name: L("校对", "Checker"),
      role: "verifier",
      duty: L("逐条核对交付，不通过就打回", "Checks every delivery and sends back what fails"),
      model: "Claude Sonnet 5.5",
      machine: L("本机", "This machine"),
      skill: "docs-review",
      skillVersion: 2,
    },
  ];
}

function tickets(lang: Lang): Ticket[] {
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
  return [
    {
      id: "T-14",
      title: L("首页加上 0.2.20 的更新说明", "Add the 0.2.20 notes to the home page"),
      stage: "yours",
      executor: "writer",
      verifier: "checker",
      rounds: 0,
      maxRounds: 3,
      spent: 0.18,
      budget: 2,
      source: "lead",
      updated: L("8 分钟前", "8 min ago"),
      need: {
        kind: "decision",
        question: L("0.2.20 的更新说明放在哪里？", "Where do the 0.2.20 notes go?"),
        options: [
          {
            label: L("首页横幅", "A home page banner"),
            description: L("一行文字，链到博客全文", "One line, linking to the full post"),
            recommended: true,
          },
          { label: L("只放博客", "The blog only") },
          { label: L("两处都放", "Both") },
        ],
        rule: L("更新说明的位置：{answer}", "Where release notes go: {answer}"),
      },
      log: [
        {
          at: L("20 分钟前", "20 min ago"),
          text: L("主理从发布计划拆出本单", "The lead split this off the release plan"),
        },
        {
          at: L("8 分钟前", "8 min ago"),
          text: L("写作提问：放在哪里？", "The writer asked where it goes"),
        },
      ],
    },
    {
      id: "T-12",
      title: L("安装页补上 Windows 步骤", "Add the Windows steps to the install page"),
      stage: "yours",
      executor: "writer",
      verifier: "checker",
      rounds: 1,
      maxRounds: 3,
      spent: 1.34,
      budget: 2,
      source: "lead",
      updated: L("12 分钟前", "12 min ago"),
      need: {
        kind: "accept",
        verdict: L(
          "三处步骤在 Windows 11 上逐条走通，截图已换成新版；PowerShell 的执行策略说明补上了。",
          "All three steps run on Windows 11, the screenshots are current, and the PowerShell execution policy note is in.",
        ),
        grade: "review",
        workbench: L("文档改动对比", "Docs diff"),
        workbenchApp: REVIEW_APP,
      },
      log: [
        {
          at: L("2 小时前", "2 h ago"),
          text: L("写作交付第 1 版", "The writer delivered version 1"),
        },
        {
          at: L("2 小时前", "2 h ago"),
          text: L("校对打回：截图还是旧版", "The checker sent it back: old screenshots"),
        },
        {
          at: L("40 分钟前", "40 min ago"),
          text: L("写作交付第 2 版", "The writer delivered version 2"),
        },
        { at: L("12 分钟前", "12 min ago"), text: L("校对通过", "The checker passed it") },
      ],
    },
    {
      id: "T-11",
      title: L("修掉插件市场页的死链", "Fix the dead links on the plugin market page"),
      stage: "halted",
      executor: "runner",
      verifier: "checker",
      rounds: 3,
      maxRounds: 3,
      spent: 1.86,
      budget: 2,
      source: "schedule",
      updated: L("25 分钟前", "25 min ago"),
      need: {
        kind: "breaker",
        reason: "rounds",
        verdict: L(
          "仍有 2 个外链返回 404，都在第三方站点，改文档解决不了。",
          "Two outside links still return 404. Both are on third-party sites; no docs edit can fix them.",
        ),
      },
      log: [
        {
          at: L("昨天", "yesterday"),
          text: L("每周链接检查发现 5 个死链", "The weekly link check found 5 dead links"),
        },
        {
          at: L("3 小时前", "3 h ago"),
          text: L("第 3 次打回：仍有 2 处 404", "Third send-back: 2 links still 404"),
        },
        {
          at: L("25 分钟前", "25 min ago"),
          text: L("打回达到上限，服务端熔断", "Send-back limit reached; the server halted it"),
        },
      ],
    },
    {
      id: "T-15",
      title: L("配置文档对齐 0.2.20", "Bring the configuration page up to 0.2.20"),
      stage: "working",
      executor: "writer",
      verifier: "checker",
      rounds: 0,
      maxRounds: 3,
      spent: 0.42,
      budget: 2,
      source: "lead",
      updated: L("3 分钟前", "3 min ago"),
      log: [{ at: L("15 分钟前", "15 min ago"), text: L("写作开始", "The writer started") }],
    },
    {
      id: "T-13",
      title: L("把 API 示例全部跑一遍", "Run every API sample"),
      stage: "verifying",
      executor: "runner",
      verifier: "checker",
      rounds: 1,
      maxRounds: 3,
      spent: 1.1,
      budget: 2,
      source: "lead",
      updated: L("6 分钟前", "6 min ago"),
      log: [
        {
          at: L("1 小时前", "1 h ago"),
          text: L("校对打回：用的是旧版 CLI", "The checker sent it back: an old CLI"),
        },
        {
          at: L("6 分钟前", "6 min ago"),
          text: L("示例交付第 2 版，校对验证中", "Version 2 delivered; the checker is verifying"),
        },
      ],
    },
    {
      id: "T-10",
      title: L("修好博客的 RSS", "Fix the blog's RSS feed"),
      stage: "done",
      executor: "writer",
      verifier: "checker",
      rounds: 0,
      maxRounds: 3,
      spent: 0.36,
      budget: 2,
      source: "schedule",
      updated: L("昨天", "yesterday"),
      outcome: L("已验收", "Accepted"),
      log: [{ at: L("昨天", "yesterday"), text: L("你接受了交付", "You accepted the delivery") }],
    },
    {
      id: "T-09",
      title: L("术语表中英对齐", "Align the glossary across both languages"),
      stage: "done",
      executor: "writer",
      verifier: "checker",
      rounds: 1,
      maxRounds: 3,
      spent: 0.92,
      budget: 2,
      source: "lead",
      updated: L("2 天前", "2 days ago"),
      outcome: L("已验收", "Accepted"),
      log: [
        { at: L("2 天前", "2 days ago"), text: L("你接受了交付", "You accepted the delivery") },
      ],
    },
  ];
}

export function demoOrgs(lang: Lang): Org[] {
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
  return [
    {
      id: "docs-site",
      name: L("文档站维护", "Docs upkeep"),
      goal: L(
        "每个版本发布后两天内，文档、示例和更新说明全部跟上",
        "Within two days of every release, the docs, samples and notes all catch up",
      ),
      members: members(lang),
      tickets: tickets(lang),
      handbook: [
        {
          id: "rule-T-06",
          kind: "rule",
          text: L(
            "对外发布的文字先给草稿，由我自己发",
            "Outward text arrives as a draft; I send it myself",
          ),
          ticket: "T-06",
        },
        {
          id: "rule-T-09",
          kind: "rule",
          text: L("截图统一用 Frost 主题浅色", "Screenshots use the Frost theme, light mode"),
          ticket: "T-09",
        },
        {
          id: "lesson-T-13-1",
          kind: "lesson",
          text: L("跑示例前先装上当前版本的 CLI", "Install the current CLI before running samples"),
          ticket: "T-13",
          member: "runner",
        },
        {
          id: "lesson-T-12-1",
          kind: "lesson",
          text: L("截图跟着版本号一起换", "Replace screenshots along with the version number"),
          ticket: "T-12",
          member: "writer",
        },
      ],
    },
  ];
}

export interface Template {
  id: string;
  name: string;
  summary: string;
  executors: number;
  workbench: string;
  trigger: string;
  maxRounds: number;
  budget: number;
  otherPlugin?: true;
}

export function templates(lang: Lang): Template[] {
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
  return [
    {
      id: "maintenance",
      name: L("软件维护", "Software upkeep"),
      summary: L(
        "修 issue、发版本、跟进依赖升级",
        "Fix issues, cut releases, keep dependencies current",
      ),
      executors: 2,
      workbench: L("代码改动对比", "Code diff"),
      trigger: L("主理拆单 · 定时巡检", "The lead's split · a scheduled sweep"),
      maxRounds: 3,
      budget: 3,
    },
    {
      id: "research",
      name: L("科研实验", "Research lab"),
      summary: L(
        "在批准的算力内跑实验，作者和审稿互相挑刺",
        "Run experiments inside an approved budget; authors and reviewers challenge each other",
      ),
      executors: 2,
      workbench: L("实验曲线", "Experiment curves"),
      trigger: L("主理拆单", "The lead's split"),
      maxRounds: 2,
      budget: 20,
    },
    {
      id: "operations",
      name: L("内容运营", "Content operations"),
      summary: L(
        "每天的资讯摘要和回复草稿，发出去之前都过你",
        "A daily digest and reply drafts; nothing goes out without you",
      ),
      executors: 1,
      workbench: L("预填回复", "Prefilled replies"),
      trigger: L("每天定时", "Daily schedule"),
      maxRounds: 2,
      budget: 1,
    },
    {
      id: "mirror",
      name: L("现实公司镜像", "Real-company mirror"),
      summary: L(
        "团队成员的数字分身在飞书、微信里传话答疑",
        "Digital twins relay and answer for your team in Feishu or WeChat",
      ),
      executors: 1,
      workbench: "",
      trigger: "",
      maxRounds: 0,
      budget: 0,
      otherPlugin: true,
    },
  ];
}

export function orgFromTemplate(template: Template, goal: string, lang: Lang): Org {
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const crew = members(lang);
  const lead = crew.find((m) => m.role === "lead")!;
  const verifier = crew.find((m) => m.role === "verifier")!;
  const executors = crew.filter((m) => m.role === "executor").slice(0, template.executors);
  const target = goal.trim() === "" ? template.summary : goal.trim();
  return {
    id: `org-${template.id}`,
    name: template.name,
    goal: target,
    members: [lead, ...executors, verifier],
    tickets: [
      {
        id: "T-1",
        title: L("和你对齐目标", "Settle the goal with you"),
        stage: "yours",
        executor: lead.id,
        verifier: verifier.id,
        rounds: 0,
        maxRounds: template.maxRounds,
        spent: 0.04,
        budget: template.budget,
        source: "lead",
        updated: L("刚刚", "just now"),
        need: {
          kind: "decision",
          question: L("第一周先做哪件事？", "What comes first this week?"),
          options: [
            {
              label: L("先盘点现状，列出问题", "Survey the current state and list the problems"),
              recommended: true,
            },
            { label: L("直接处理最紧急的一件", "Take the most urgent item now") },
            { label: L("先定验收标准", "Agree on the acceptance bar first") },
          ],
          rule: L("开局顺序：{answer}", "How work starts: {answer}"),
        },
        log: [
          {
            at: L("刚刚", "just now"),
            text: L("主理读了目标：", "The lead read the goal: ") + target,
          },
        ],
      },
    ],
    handbook: [],
  };
}
