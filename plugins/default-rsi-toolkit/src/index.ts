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
        id: "default-rsi-toolkit.card",
        title: "Default RSI Toolkit",
        titleZh: "默认自进化工具包",
        descriptionZh:
          "默认 RSI 工具包：把「试跑 → 反思 → 提升」的循环做成一个 Skill——依据 Benchmark 的实测结果逐轮改进 Agent，每轮之前自动快照。测量经由 Agent Evaluation 插件的 agent-evaluation Skill 完成。",
        shortDescription: "Default RSI Toolkit: trial, reflect, improve.",
        shortDescriptionZh: "默认 RSI 工具包：试跑、反思、提升。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "List this Project's Benchmarks with their latest scores, then propose which agent to optimize on which Benchmark and for how many rounds. Wait for my go-ahead before starting.",
          promptZh:
            "列出本 Project 的 Benchmark 和各自最近的分数，再建议用哪个 Benchmark 优化哪个 Agent、跑几轮。等我确认后再开始。",
          skills: ["agent-optimization"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "default-rsi-toolkit.skill.agent-optimization",
        name: "agent-optimization",
        path: "skills/agent-optimization",
      },
    ],
  },
})
export class DefaultRsiToolkitPlugin {}

export default { modules: [DefaultRsiToolkitPlugin] } satisfies Plugin;
