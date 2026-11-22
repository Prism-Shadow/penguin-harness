// These starters use the same editable text and shapes as a document drawn in Bento.
const copy = {
  en: {
    brief: {
      label: "Project brief",
      title: "A new onboarding guide",
      audience: "Project proposal",
      subtitle: "One starting point for a new hire’s first week.",
      coverNote: "Introduce the project and the decision you need from the room.",
      scope: "Where the guide starts and ends",
      scopeItems: [
        [
          "In scope",
          "A first-week checklist, links to essential tools and a named contact for each step.",
        ],
        ["For a later release", "Role-specific training and the full employee handbook."],
      ],
      scopeNote:
        "Replace these boundaries with the work your team can deliver in the first release.",
      stages: "From draft to rollout",
      stageItems: [
        ["Draft", "Map the first week with recent hires."],
        ["Pilot", "Try the guide with one incoming group."],
        ["Release", "Revise the checklist and assign an owner."],
      ],
      stagesNote: "Add a date and owner to each milestone before sharing the plan.",
      decision: "Decision requested",
      question: "Can we pilot the guide with the next group of new hires?",
      action: "Next step",
      actionBody: "People Operations selects the pilot group and schedules a feedback session.",
      decisionNote: "Confirm who will make the decision, and record the agreed next step.",
    },
    retro: {
      label: "Team retrospective",
      title: "First-week pilot retrospective",
      audience: "Team retrospective",
      subtitle: "What happened during the pilot, and what to change for the next group.",
      coverNote: "Introduce the pilot and the period covered.",
      scope: "What the pilot tested",
      scopeItems: [
        ["Starting point", "Essential links were spread across individual welcome messages."],
        ["What we tried", "Each new hire received one checklist and a named point of contact."],
      ],
      scopeNote: "Replace the example with a short account of your own pilot and its participants.",
      stages: "Keep, change, try",
      stageItems: [
        ["Keep", "A single place to find the tasks for day one."],
        ["Change", "Make account access requests before the start date."],
        ["Try", "Ask which instruction was hardest to follow."],
      ],
      stagesNote: "Add one observation from the team for each change you propose.",
      decision: "Next experiment",
      question: "Does requesting access earlier help the next group start on time?",
      action: "Review point",
      actionBody:
        "The onboarding lead checks access on day one and reviews feedback at the end of the week.",
      decisionNote:
        "Agree on the owner, what evidence to collect and when the team will review it.",
    },
  },
  zh: {
    brief: {
      label: "项目简报",
      title: "新人入职指南改版",
      audience: "项目提案",
      subtitle: "给新同事一份入职第一周就能用的指南。",
      coverNote: "介绍这个项目，以及今天希望大家决定的事情。",
      scope: "这次改版做哪些事",
      scopeItems: [
        ["本期交付", "第一周的任务清单、常用工具入口，以及每项任务的对接人。"],
        ["留待下期", "各岗位的专项培训，以及完整的员工手册。"],
      ],
      scopeNote: "把这两个范围换成本次项目实际约定的交付边界。",
      stages: "从初稿到上线",
      stageItems: [
        ["起草", "和刚入职的同事一起梳理第一周的安排。"],
        ["试用", "请下一批新同事按指南走一遍。"],
        ["发布", "根据试用反馈修订清单，明确维护人。"],
      ],
      stagesNote: "分享前，给每个阶段补上日期和负责人。",
      decision: "本次需要确认",
      question: "下一批新同事入职时，要不要先试用这份指南？",
      action: "下一步",
      actionBody: "由人力团队确定试用人员，约好收集反馈的时间。",
      decisionNote: "确认由谁拍板，并记录讨论后的下一步。",
    },
    retro: {
      label: "团队复盘",
      title: "入职指南试用复盘",
      audience: "团队复盘",
      subtitle: "回顾这轮试用的变化，决定下批新同事入职前要改什么。",
      coverNote: "介绍这次试用的时间、参与人和回顾范围。",
      scope: "这次试用了什么",
      scopeItems: [
        ["原先的做法", "常用链接分散在不同同事发来的欢迎消息里。"],
        ["这次的尝试", "每位新人收到同一份任务清单，每个环节都有对接人。"],
      ],
      scopeNote: "把示例换成团队实际尝试过的做法和参与对象。",
      stages: "保留、调整、尝试",
      stageItems: [
        ["保留", "第一天要做的事都能在同一个地方找到。"],
        ["调整", "把账号申请提前到报到之前。"],
        ["尝试", "请新同事指出最难理解的一条说明。"],
      ],
      stagesNote: "为每项改进补上一条来自团队的具体观察。",
      decision: "下一轮试验",
      question: "提前申请账号，能否让下一批新同事第一天就开始工作？",
      action: "回访安排",
      actionBody: "由入职负责人在报到日检查账号，周末汇总使用反馈。",
      decisionNote: "约好负责人、要观察的现象，以及下一次回顾的时间。",
    },
  },
};
const palettes = {
  brief: {
    paper: "#FAF9F5",
    ink: "#242540",
    accent: "#5143A3",
    tint: "#E5E1F4",
    cover: "#302A59",
    coverInk: "#FFFFFF",
    coverAccent: "#C9C1F2",
  },
  retro: {
    paper: "#FFFCF2",
    ink: "#173D35",
    accent: "#246350",
    tint: "#DBE9DC",
    cover: "#F3EACB",
    coverInk: "#173D35",
    coverAccent: "#246350",
  },
};

function text(id, value, x, y, w, h, fontSize, color, fontWeight = 400) {
  return {
    id,
    type: "text",
    ...(id === "title" ? { role: "title" } : {}),
    x,
    y,
    w,
    h,
    html: value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    fontSize,
    fontWeight,
    fontFamily: "system-ui, sans-serif",
    color,
    align: "left",
    valign: "top",
    lineHeight: 1.16,
    rotation: 0,
    opacity: 1,
  };
}
function rect(id, x, y, w, h, fill) {
  return {
    id,
    type: "shape",
    shape: "rect",
    x,
    y,
    w,
    h,
    fill,
    stroke: "none",
    strokeWidth: 0,
    rotation: 0,
    opacity: 1,
  };
}
const slide = (id, background, notes, elements) => ({
  id,
  background,
  notes,
  transition: "none",
  elements,
});

export function deckTemplates(locale) {
  return Object.entries(copy[locale]).map(([id, entry]) => ({
    id,
    label: entry.label,
    title: entry.title,
  }));
}
export function templateDeck(locale, key, title) {
  const c = copy[locale][key],
    p = palettes[key];
  // A long user-entered title stays inside the editable cover in either language.
  const ems = Array.from(title).reduce(
    (sum, char) => sum + (char.codePointAt(0) < 256 ? 0.64 : 1),
    0,
  );
  const titleSize = Math.min(
    84,
    Math.floor(Math.sqrt((0.74 * 1112 * 260) / (1.16 * Math.max(1, ems)))),
  );
  const cover = slide("cover", p.cover, c.coverNote, [
    rect("marker", 84, 88, 90, 10, p.coverAccent),
    text("kind", c.audience, 84, 126, 1080, 58, 34, p.coverAccent, 650),
    text("title", title, 84, 224, 1112, 276, titleSize, p.coverInk, 750),
    rect("rule", 84, 536, 1112, 3, p.coverAccent),
    text("summary", c.subtitle, 84, 575, 1112, 104, 32, p.coverInk),
  ]);
  const scope = slide("scope", p.paper, c.scopeNote, [
    text("title", c.scope, 80, 65, 1120, 135, 60, p.ink, 730),
    ...c.scopeItems.flatMap(([label, body], i) => {
      const x = 80 + i * 578;
      return [
        rect("line-" + i, x, 251, 522, 7, p.accent),
        text("label-" + i, label, x, 287, 522, 105, 42, p.accent, 700),
        text("body-" + i, body, x, 402, 506, 225, 34, p.ink),
      ];
    }),
  ]);
  const stages = slide("stages", p.paper, c.stagesNote, [
    text("title", c.stages, 80, 65, 1120, 132, 60, p.ink, 730),
    ...c.stageItems.flatMap(([label, body], i) => {
      if (key === "retro") {
        const x = 80 + i * 380;
        return [
          rect("panel-" + i, x, 230, 352, 370, p.tint),
          text("label-" + i, label, x + 28, 276, 296, 78, 44, p.accent, 700),
          text("body-" + i, body, x + 28, 385, 296, 185, 30, p.ink),
        ];
      }
      const y = 218 + i * 140;
      return [
        rect("band-" + i, 80, y, 1120, 2, p.accent),
        text("label-" + i, label, 80, y + 25, 302, 92, 39, p.accent, 700),
        text("body-" + i, body, 398, y + 29, 776, 92, 32, p.ink),
      ];
    }),
  ]);
  const decision = slide("decision", p.tint, c.decisionNote, [
    text("kind", c.decision, 84, 75, 1100, 66, 32, p.accent, 650),
    text("title", c.question, 84, 177, 1096, 240, 66, p.ink, 730),
    rect("rule", 84, 462, 1112, 4, p.accent),
    text("action", c.action, 84, 513, 260, 100, 38, p.accent, 700),
    text("body", c.actionBody, 370, 515, 820, 155, 31, p.ink),
  ]);
  return {
    format: "bento/slides",
    version: 1,
    title,
    size: { width: 1280, height: 720 },
    theme: {
      background: p.paper,
      color: p.ink,
      accent: p.accent,
      fontFamily: "system-ui, sans-serif",
    },
    slides: [cover, scope, stages, decision],
  };
}
