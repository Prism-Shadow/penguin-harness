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
        id: "ace-rsi-toolkit.card",
        title: "ACE RSI Toolkit",
        titleZh: "ACE 自进化工具包",
        descriptionZh:
          "ACE RSI 工具包：按论文《Agentic Context Engineering》（Zhang 等，2025，https://arxiv.org/abs/2510.04618）的顺序离线算法——Reflector 逐条阅读训练轨迹，Curator 把教训并入 Target 每次任务前都会读的规则手册（playbook），最终手册在冻结的 Benchmark 上测量。自成一体：自行创建 Target 的手册 Skill、自行评测每个单元、写入评估中心的记分板。",
        shortDescription: "ACE RSI Toolkit: evolve a playbook from Traces.",
        shortDescriptionZh: "ACE RSI 工具包：从轨迹进化规则手册。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Use the `ace-rsi-toolkit` Skill to run ACE on an agent of this Project: ask me for the Test Agent and the published Benchmark to train on, initialize the playbook, run one epoch at the smoke budget, and report the baseline and final scores.",
          promptZh:
            "使用 `ace-rsi-toolkit` 技能在本 Project 的一个智能体上运行 ACE：先问我被测智能体与用于训练的已发布 Benchmark，初始化规则手册，以冒烟预算跑一个 epoch，报告基线分与最终分。",
          skills: ["ace-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2510.04618"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "ace-rsi-toolkit.skill.ace-rsi-toolkit",
        name: "ace-rsi-toolkit",
        path: "skills/ace-rsi-toolkit",
      },
    ],
  },
})
export class AceRsiToolkitPlugin {}

export default { modules: [AceRsiToolkitPlugin] } satisfies Plugin;
