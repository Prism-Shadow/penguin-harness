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
        id: "opro-rsi-toolkit.card",
        title: "OPRO RSI Toolkit",
        titleZh: "OPRO 自进化工具包",
        descriptionZh:
          "OPRO RSI 工具包：按论文《Large Language Models as Optimizers》（Yang 等，2023，https://arxiv.org/abs/2309.03409）的流程运行——优化器依据历史指令与分数提出新指令，每个候选都在冻结的 Benchmark 上测量，保留得分最高的指令。自成一体：自行创建 Target 的指令槽、自行评测每个单元、写入评估中心的记分板。",
        shortDescription: "OPRO RSI Toolkit: optimize an instruction from scores.",
        shortDescriptionZh: "OPRO RSI 工具包：由分数优化指令。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Use the `opro-rsi-toolkit` Skill to reproduce OPRO on the precise-summary demo task that ships with it: create the Target agent `summary_writer` and the Benchmark `precise-summary`, measure the seed instruction, run 2 steps × 4 proposals, and report the baseline and best scores.",
          promptZh:
            "使用 `opro-rsi-toolkit` 技能在它自带的「精确摘要」演示任务上复现 OPRO：创建 Target 智能体 `summary_writer` 与 Benchmark `precise-summary`，测量种子指令，跑 2 步 × 4 个提案，报告基线分与最佳分。",
          skills: ["opro-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2309.03409"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "opro-rsi-toolkit.skill.opro-rsi-toolkit",
        name: "opro-rsi-toolkit",
        path: "skills/opro-rsi-toolkit",
      },
    ],
  },
})
export class OproRsiToolkitPlugin {}

export default { modules: [OproRsiToolkitPlugin] } satisfies Plugin;
