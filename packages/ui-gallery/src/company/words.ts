export const zh = {
  appName: "公司",
  draftNote: "设计草案：公司模式作为应用中心里的一个插件应用，数据为演示用。",
  org: {
    switch: "切换组织",
    create: "新建组织",
  },
  jobs: {
    newJob: "新任务",
    newJobHint: "在对话页开一个新会话，交给组织里的成员",
    groups: {
      waiting: (n: number) => `等你（${n}）`,
      running: (n: number) => `进行中（${n}）`,
      done: (n: number) => `已完成（${n}）`,
    },
    empty: "还没有任务。点「新任务」开一个会话交给主理。",
    waitingApproval: "等你批准",
    approvalHint: (n: number) => `${n} 个操作等你批准，打开会话处理`,
    running: "运行中",
    scheduled: "定时任务开的会话",
    more: "更多操作",
    copyId: "复制会话 ID",
    copied: "已复制会话 ID",
    stop: "停止",
    stopped: (title: string) => `已停止「${title}」`,
  },
  create: {
    title: "新建组织",
    description: "一句话说清目标，主理会在第一个会话里和你对齐细节。",
    goal: "目标",
    goalPlaceholder: "例如：维护 PenguinHarness 文档站，每个版本发布后两天内文档跟上",
    toLead: "交给主理",
    templates: "从模板开始",
    templatesInfo:
      "模板是一份可导入导出的组织包：成员、各自的模型和 Skill，以及什么时候自己开会话。",
    plan: "方案",
    planTeam: "成员",
    planTrigger: "自己开会话",
    cancel: "取消",
    createOrg: "创建组织",
    otherPlugin: "另一个插件",
    otherPluginHint: "镜像现实公司依赖聊天入口，由消息插件承接，不进公司应用的主流程",
    created: (name: string) => `已创建「${name}」`,
  },
};

export type Words = typeof zh;
