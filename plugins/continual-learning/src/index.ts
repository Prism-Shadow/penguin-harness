import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/**
 * Everything this plugin carries, declared for the plugin library. Data only: the class has no
 * body and the package no entry point; `build` writes this literal into `ifaces.json`.
 */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "continual-learning.card",
        title: "Continual Learning",
        titleZh: "持续学习",
        descriptionZh:
          "持续学习：一个 stop hook，刚结束的任务跑了超过 30 个完成的轮次时，就把该任务的浓缩摘录交给一个后台子会话，由它把值得沉淀的发现写进 Agent 自己的 Skill。",
        shortDescription: "Fold a long task's findings back into the agent's skills.",
        shortDescriptionZh: "把长任务的发现回流进 Agent 的 Skill。",
        category: "office-productivity",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            "Explain what the continual-learning hook will do after a task longer than 30 turns, then list your installed skills with one line each, marking the ones such a task could update.",
          promptZh:
            "说明持续学习钩子在超过 30 轮的任务结束后会做什么，再逐行列出你已安装的技能，标出这类任务可能会更新的那些。",
        },
      },
    ],
    "PluginLibraryModule.hooks": [
      {
        id: "continual-learning.hooks",
        version: "2026.10.24.1",
        path: "hooks",
        stop: [{ command: "stop.mjs", timeout: 60 }],
      },
    ],
  },
})
export class ContinualLearningPlugin {}

export default { modules: [ContinualLearningPlugin] } satisfies Plugin;
