import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/**
 * Plan mode: a switch in the composer's "+" menu (`composerMode`). While it is on, each message
 * the user sends runs `hooks/discuss.mjs`, whose prompt follows the message and asks the Agent to
 * settle the approach with the user before carrying it out. Data only: the class has no body and
 * the package no entry point; `build` writes this literal into `ifaces.json`.
 */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "plan.card",
        title: "Plan mode",
        titleZh: "计划模式",
        descriptionZh: "与智能体讨论目标、方案和取舍，必要时一起画架构图或撰写规划文档。",
        shortDescription: "Discuss the approach and architecture before starting a task.",
        shortDescriptionZh: "先讨论做法和架构，再开始任务。",
        category: "office-productivity",
        icon: "icon.svg",
        composerMode: true,
        // Every new Agent gets Plan mode: its hook does nothing until the switch is on.
        defaultInstall: true,
        quickStart: {
          prompt:
            "Help me plan a migration. Ask which systems and constraints matter before drafting it.",
          promptZh: "帮我规划一次迁移。请先问清涉及哪些系统和限制，再起草方案。",
        },
      },
    ],
    "PluginLibraryModule.hooks": [
      {
        id: "plan.hooks",
        version: "2026.11.19.1",
        path: "hooks",
        user_prompt: [{ command: "discuss.mjs", timeout: 15, trigger: "host" }],
      },
    ],
  },
})
export class PlanPlugin {}
export default { modules: [PlanPlugin] } satisfies Plugin;
