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
        id: "trace-rsi-toolkit.card",
        title: "TRACE RSI Toolkit",
        titleZh: "TRACE 自进化工具包",
        descriptionZh:
          "TRACE RSI 工具包：组织容器内训练与独立评测，对比轨迹修订技能库，按训练分数选择版本后测试。",
        shortDescription: "TRACE RSI Toolkit: evolve skills from contrasting trajectories.",
        shortDescriptionZh: "TRACE RSI 工具包：对比轨迹，进化技能库。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Use TRACE on the selected Project Benchmarks with the requested model and budget.",
          promptZh: "使用 TRACE，按指定模型和预算完成选定 Project Benchmark 的实验。",
          skills: ["trace-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2608.22793"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "trace-rsi-toolkit.skill.trace-rsi-toolkit",
        name: "trace-rsi-toolkit",
        path: "skills/trace-rsi-toolkit",
      },
    ],
  },
})
export class TraceRsiToolkitPlugin {}

export default { modules: [TraceRsiToolkitPlugin] } satisfies Plugin;
