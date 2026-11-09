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
        id: "gepa-rsi-toolkit.card",
        title: "GEPA RSI Toolkit",
        titleZh: "GEPA 自进化工具包",
        descriptionZh:
          "GEPA RSI 工具包：按论文《Reflective Prompt Evolution Can Outperform Reinforcement Learning》（Agrawal 等，2025，https://arxiv.org/abs/2507.19457）的流程运行——反思模型阅读 Target 在一个小批量上的轨迹与分数并改写指令，在该小批量上胜过父代的子代进入候选池、在冻结的 Benchmark 上测量，父代按逐题 Pareto 前沿抽取，保留平均分最高者。自成一体：自行创建 Target 的指令槽、自行评测每个单元、写入评估中心的记分板。",
        shortDescription: "GEPA RSI Toolkit: evolve an instruction by reflection.",
        shortDescriptionZh: "GEPA RSI 工具包：经反思进化指令。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Use the `gepa-rsi-toolkit` Skill to run GEPA on an agent of this Project: ask me for the Test Agent and the published Benchmark to optimize on, initialize the instruction slot, run the smoke budget, and report the seed and best scores.",
          promptZh:
            "使用 `gepa-rsi-toolkit` 技能在本 Project 的一个智能体上运行 GEPA：先问我被测智能体与用于优化的已发布 Benchmark，初始化指令槽，以冒烟预算运行，报告种子分与最佳分。",
          skills: ["gepa-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2507.19457"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "gepa-rsi-toolkit.skill.gepa-rsi-toolkit",
        name: "gepa-rsi-toolkit",
        path: "skills/gepa-rsi-toolkit",
      },
    ],
  },
})
export class GepaRsiToolkitPlugin {}

export default { modules: [GepaRsiToolkitPlugin] } satisfies Plugin;
