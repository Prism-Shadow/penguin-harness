/** The definition exported by the First Workbench Guide. The preview and installable board share these items. */
export const boards = {
  en: {
    title: "Launch checklist",
    request: "Make a checklist for releasing our new app.",
    group: "Before release",
    items: [
      "Review the release notes",
      "Try the install on a clean machine",
      "Publish the signed build",
    ],
  },
  zh: {
    title: "上线清单",
    request: "帮我做一个清单，跟进新应用上线前的准备。",
    group: "上线前",
    items: ["核对发行说明", "在新环境试装", "发布已签名的构建"],
  },
} as const;

/** Held-out means from the GDPEVO Essential report, table 5 and the two task walkthroughs. */
export const trials = {
  coverage: {
    before: 55,
    after: 80.67,
    method: "SkillAdam",
    en: {
      task: "Review a coverage claim",
      change: "Check the latest policy, apply each rule, then recalculate the claim.",
      material: "The untrained agent read old files alongside the current policy.",
    },
    zh: {
      task: "核对保险赔付",
      change: "先筛出有效保单，逐条核对规则，再重算赔付金额。",
      material: "基线 Agent 把旧文件和现行保单一起纳入了判断。",
    },
  },
  filing: {
    before: 52.6,
    after: 51.43,
    method: "TRACE",
    en: {
      task: "Schedule a court filing",
      change: "Test the revised Skill on new filing and scheduling cases.",
      material: "The baseline runs the same filing cases with the untrained Skill.",
    },
    zh: {
      task: "安排案件归档与排期",
      change: "冻结更新后的技能，在新案件的归档与排期任务上复测。",
      material: "基线用初始技能处理同一批留出的归档与排期案例。",
    },
  },
} as const;
