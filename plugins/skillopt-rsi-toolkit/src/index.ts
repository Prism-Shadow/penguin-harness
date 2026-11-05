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
        id: "skillopt-rsi-toolkit.card",
        title: "SkillOpt RSI Toolkit",
        titleZh: "SkillOpt 自进化工具包",
        descriptionZh:
          "SkillOpt RSI 工具包：通过有界文本编辑、候选评测和跨轮反思优化可复用 Skill，再比较冻结的 baseline 与 final。",
        shortDescription: "SkillOpt RSI Toolkit: bounded Skill edits with score-based selection.",
        shortDescriptionZh: "SkillOpt RSI 工具包：限制编辑幅度，按评分选择技能。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Read skillopt-rsi-toolkit and run a SkillOpt experiment on the selected Benchmarks with the requested model and budget.",
          promptZh:
            "读取 skillopt-rsi-toolkit，按指定模型和预算，在选定的 Benchmark 上完成 SkillOpt 实验。",
          skills: ["skillopt-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2605.23904"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "skillopt-rsi-toolkit.skill.skillopt-rsi-toolkit",
        name: "skillopt-rsi-toolkit",
        path: "skills/skillopt-rsi-toolkit",
      },
    ],
  },
})
export class SkilloptRsiToolkitPlugin {}

export default { modules: [SkilloptRsiToolkitPlugin] } satisfies Plugin;
