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
        id: "ape-rsi-toolkit.card",
        title: "APE RSI Toolkit",
        titleZh: "APE 自进化工具包",
        descriptionZh:
          "APE RSI 工具包：按论文《Large Language Models are Human-Level Prompt Engineers》（Zhou 等，2022，https://arxiv.org/abs/2211.01910）的非迭代前向生成与执行评分——提议者从输入 / 输出示例归纳候选指令，每个候选都在冻结的 Benchmark 上测量，保留最优者。自成一体：自行创建 Target 的指令槽、自行评测每个单元、写入评估中心的记分板。",
        shortDescription: "APE RSI Toolkit: induce an instruction from examples.",
        shortDescriptionZh: "APE RSI 工具包：从示例归纳指令。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Reproduce APE (Automatic Prompt Engineer, Zhou et al. 2022) on the house-style brief task that ships with the `ape-rsi-toolkit` Skill: a fresh agent, a 6-case Benchmark, and the score before and after.",
          promptZh:
            "在 `ape-rsi-toolkit` 技能自带的「公司格式简报」任务上复现 APE（Automatic Prompt Engineer，Zhou 等，2022）：新建一个 Agent、一套 6 题的 Benchmark，给我看优化前后的分数。",
          skills: ["ape-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2211.01910"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "ape-rsi-toolkit.skill.ape-rsi-toolkit",
        name: "ape-rsi-toolkit",
        path: "skills/ape-rsi-toolkit",
      },
    ],
  },
})
export class ApeRsiToolkitPlugin {}

export default { modules: [ApeRsiToolkitPlugin] } satisfies Plugin;
