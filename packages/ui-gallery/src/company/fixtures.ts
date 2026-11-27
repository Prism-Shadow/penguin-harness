import { IDS } from "../app/mock/ids";
import type { Lang } from "./frame";
import type { Job, Member, Org } from "./model";

export const NEW_SESSION = "/chat/new";

export function sessionPath(session: string): string {
  return `/chat/${encodeURIComponent(session)}`;
}

function crew(lang: Lang): Member[] {
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
  return [
    { id: "lead", name: L("主理", "Lead"), agent: IDS.agents.notes, lead: true },
    { id: "docs", name: L("文档", "Docs"), agent: IDS.agents.docs },
  ];
}

function jobs(lang: Lang): Job[] {
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const s = IDS.sessions;
  return [
    {
      session: s.orgDesk,
      title: L("本周发布摘要", "This week's release digest"),
      member: "lead",
      running: false,
      approvals: 0,
      time: L("12 分钟前", "12m"),
      source: "schedule",
      children: [
        {
          session: s.approval,
          title: L("发布文档包", "Publish the docs package"),
          member: "docs",
          running: true,
          approvals: 1,
          time: L("刚刚", "now"),
        },
        {
          session: s.runningTool,
          title: L("检查文档里的全部链接", "Check every link in the docs"),
          member: "docs",
          running: true,
          approvals: 0,
          time: L("1 分钟前", "1m"),
        },
      ],
    },
    {
      session: s.thinking,
      title: L("规划 0.3 发布说明", "Plan the 0.3 release notes"),
      member: "docs",
      running: true,
      approvals: 0,
      time: L("刚刚", "now"),
      source: "you",
    },
    {
      session: s.streaming,
      title: L("讲解引用校验", "Explain the citation guard"),
      member: "docs",
      running: true,
      approvals: 0,
      time: L("刚刚", "now"),
      source: "you",
    },
    {
      session: s.done,
      title: L("为 hooks 文档建立索引", "Index the hooks docs"),
      member: "docs",
      running: false,
      approvals: 0,
      time: L("45 分钟前", "45m"),
      source: "you",
      children: [
        {
          session: s.subagent,
          title: L("检查 hooks.md 的链接", "Check links in hooks.md"),
          member: "docs",
          running: false,
          approvals: 0,
          time: L("44 分钟前", "44m"),
        },
      ],
    },
    {
      session: s.harness,
      title: L("修复 hooks 文档的引用", "Fix the hooks doc citations"),
      member: "docs",
      running: false,
      approvals: 0,
      time: L("1 天前", "1d"),
      source: "you",
    },
    {
      session: s.notes[0],
      title: L("0.2.13 发布说明", "0.2.13 release notes"),
      member: "lead",
      running: false,
      approvals: 0,
      time: L("5 天前", "5d"),
      source: "you",
    },
    {
      session: s.notes[1],
      title: L("破坏性变更清单", "Breaking changes list"),
      member: "lead",
      running: false,
      approvals: 0,
      time: L("9 天前", "9d"),
      source: "you",
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
      members: crew(lang),
      jobs: jobs(lang),
    },
  ];
}

export interface Template {
  id: string;
  name: string;
  summary: string;
  members: readonly string[];
  trigger: string;
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
      members: [L("主理", "Lead"), L("开发", "Developer"), L("评审", "Reviewer")],
      trigger: L("每天巡检一次", "A daily sweep"),
    },
    {
      id: "research",
      name: L("科研实验", "Research lab"),
      summary: L(
        "在批准的算力内跑实验，作者和审稿互相挑刺",
        "Run experiments inside an approved budget; authors and reviewers challenge each other",
      ),
      members: [L("主理", "Lead"), L("作者", "Author"), L("审稿", "Reviewer")],
      trigger: L("只在你交代时", "Only when you ask"),
    },
    {
      id: "operations",
      name: L("内容运营", "Content operations"),
      summary: L(
        "每天的资讯摘要和回复草稿，发出去之前都过你",
        "A daily digest and reply drafts; nothing goes out without you",
      ),
      members: [L("主理", "Lead"), L("编辑", "Editor")],
      trigger: L("每天早上", "Every morning"),
    },
    {
      id: "mirror",
      name: L("现实公司镜像", "Real-company mirror"),
      summary: L(
        "团队成员的数字分身在飞书、微信里传话答疑",
        "Digital twins relay and answer for your team in Feishu or WeChat",
      ),
      members: [],
      trigger: "",
      otherPlugin: true,
    },
  ];
}

export function orgFromTemplate(template: Template, goal: string): Org {
  const target = goal.trim() === "" ? template.summary : goal.trim();
  return {
    id: `org-${template.id}`,
    name: template.name,
    goal: target,
    members: template.members.map((name, i) =>
      i === 0
        ? { id: `m${i}`, name, agent: IDS.agents.notes, lead: true }
        : { id: `m${i}`, name, agent: IDS.agents.docs },
    ),
    jobs: [],
  };
}
