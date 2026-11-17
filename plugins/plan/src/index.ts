import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "plan.card",
        title: "Plan mode",
        titleZh: "计划模式",
        descriptionZh: "先讨论需求、阅读相关文件、来回调整方案，批准后再开始执行。",
        shortDescription: "Discuss and revise a plan before approving it for execution.",
        shortDescriptionZh: "先讨论和修订方案，批准后再执行。",
        category: "office-productivity",
        icon: "icon.svg",
        quickStart: {
          plan: true,
          prompt:
            "Help me plan a migration. Ask which systems and constraints matter before drafting it.",
          promptZh: "帮我规划一次迁移。请先问清涉及哪些系统和限制，再起草方案。",
        },
      },
    ],
    "PluginLibraryModule.hooks": [
      {
        id: "plan.hooks",
        version: "2026.11.18.1",
        path: "hooks",
        user_prompt: [{ command: "discuss.mjs", timeout: 15, trigger: "host" }],
      },
    ],
  },
})
export class PlanPlugin {}
export default { modules: [PlanPlugin] } satisfies Plugin;
