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
        id: "skilladam-rsi-toolkit.card",
        title: "SkillAdam RSI Toolkit",
        titleZh: "SkillAdam 自进化工具包",
        descriptionZh:
          "SkillAdam RSI 工具包：组织 benchmark 实验，结合执行轨迹、持续更新的问题记录、配对评测和按方差调整的编辑预算，迭代优化目标 Agent 的技能。",
        shortDescription: "SkillAdam RSI Toolkit: evolve a Skill from execution feedback.",
        shortDescriptionZh: "SkillAdam RSI 工具包：根据执行反馈迭代技能。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Read skilladam-rsi-toolkit and run a SkillAdam experiment on the selected benchmark with the requested model and budget.",
          promptZh:
            "读取 skilladam-rsi-toolkit，按指定模型和预算，在选定的 benchmark 上完成 SkillAdam 实验。",
          skills: ["skilladam-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2609.08944"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "skilladam-rsi-toolkit.skill.skilladam-rsi-toolkit",
        name: "skilladam-rsi-toolkit",
        path: "skills/skilladam-rsi-toolkit",
      },
    ],
  },
})
export class SkilladamRsiToolkitPlugin {}

export default { modules: [SkilladamRsiToolkitPlugin] } satisfies Plugin;
