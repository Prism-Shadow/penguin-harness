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
        id: "goal.card",
        title: "Goal Mode",
        titleZh: "目标模式",
        descriptionZh:
          "目标模式：一个 stop hook，让会话持续朝目标工作——每轮重新注入目标并检查目标文件——直到目标完成、受阻或 token 预算耗尽。",
        shortDescription: "Loop the session on an objective until it is done.",
        shortDescriptionZh: "让会话循环推进一个目标直到完成。",
        category: "office-productivity",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Write fizzbuzz.py in this Workspace that prints FizzBuzz for 1 to 30, run it, and check that every line of the output is right.",
          promptZh:
            "在当前工作区写一个 fizzbuzz.py，打印 1 到 30 的 FizzBuzz，运行它，并逐行确认输出正确。",
          goal: true,
        },
      },
    ],
    "PluginLibraryModule.hooks": [
      {
        id: "goal.hooks",
        version: "2026.10.26.1",
        path: "hooks",
        user_prompt: [{ command: "start.mjs", timeout: 60, trigger: "host" }],
        stop: [{ command: "stop.mjs", timeout: 60 }],
      },
    ],
  },
})
export class GoalPlugin {}

export default { modules: [GoalPlugin] } satisfies Plugin;
