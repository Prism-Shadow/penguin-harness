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
        id: "rrsi-rsi-toolkit.card",
        title: "RRSI RSI Toolkit",
        titleZh: "RRSI 自进化工具包",
        descriptionZh:
          "RRSI RSI 工具包：按论文《Regularized Recursive Self-Improvement of Agent Harnesses》（Xia 等，2026，https://arxiv.org/abs/2609.24972）的流程运行——退火修改预算限定每个提案能捆绑多少处独立改动，防基准过拟合的 Critic 在花费任何测量之前筛掉任务特化的改动，Pruner 删除已不再挣得位置的机制，再由噪声下限与 token 成本规则选出下一代 harness。自成一体：自行创建 Target 的 harness 槽、自行评测每个单元、写入评估中心的记分板。",
        shortDescription: "RRSI RSI Toolkit: evolve a harness without overfitting.",
        shortDescriptionZh: "RRSI RSI 工具包：演化 harness 且不致基准过拟合。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Use the `rrsi-rsi-toolkit` Skill to reproduce RRSI on the smoke demo task that ships with it: create the Target agent `rrsi_smoke` and the Benchmark `rrsi-smoke`, measure the baseline H_0 to calibrate the noise band, then run one round with the smoke profile (T = 1, m = 1, k = 1, b_max = 2) and report the baseline score, the candidate's Critic verdict, its delta S and delta C, and the selection decision.",
          promptZh:
            "使用 `rrsi-rsi-toolkit` 技能在它自带的冒烟演示任务上复现 RRSI：创建 Target 智能体 `rrsi_smoke` 与 Benchmark `rrsi-smoke`，测量基线 H_0 以标定噪声带宽，然后按冒烟档（T = 1、m = 1、k = 1、b_max = 2）跑一轮，报告基线分、候选的 Critic 裁决、它的 delta S 与 delta C，以及选择结论。",
          skills: ["rrsi-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2609.24972"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "rrsi-rsi-toolkit.skill.rrsi-rsi-toolkit",
        name: "rrsi-rsi-toolkit",
        path: "skills/rrsi-rsi-toolkit",
      },
    ],
  },
})
export class RrsiRsiToolkitPlugin {}

export default { modules: [RrsiRsiToolkitPlugin] } satisfies Plugin;
