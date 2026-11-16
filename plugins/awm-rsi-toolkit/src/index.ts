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
        id: "awm-rsi-toolkit.card",
        title: "AWM RSI Toolkit",
        titleZh: "AWM 自进化工具包",
        descriptionZh:
          "AWM RSI 工具包：按论文《Agent Workflow Memory》（Wang 等，2024，https://arxiv.org/abs/2409.07429）——从成功轨迹归纳工作流并存入 Target 的记忆，在线（训练流）或离线（给定经验）两种模式，冻结后在 Benchmark 上独立测试。自成一体：自行创建 Target 的工作流记忆、自行评测每个单元、写入评估中心的记分板。",
        shortDescription: "AWM RSI Toolkit: induce workflows from trajectories.",
        shortDescriptionZh: "AWM RSI 工具包：从轨迹归纳工作流。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Use the `awm-rsi-toolkit` Skill to run AWM on an agent of this Project: ask me for the Test Agent and the published Benchmark, run the online_train mode over its cases once at the smoke budget, freeze the workflow memory, and report the baseline and final scores.",
          promptZh:
            "使用 `awm-rsi-toolkit` 技能在本 Project 的一个智能体上运行 AWM：先问我被测智能体与已发布的 Benchmark，以冒烟预算按 online_train 模式跑一遍题目，冻结工作流记忆，报告基线分与最终分。",
          skills: ["awm-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2409.07429"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "awm-rsi-toolkit.skill.awm-rsi-toolkit",
        name: "awm-rsi-toolkit",
        path: "skills/awm-rsi-toolkit",
      },
    ],
  },
})
export class AwmRsiToolkitPlugin {}

export default { modules: [AwmRsiToolkitPlugin] } satisfies Plugin;
