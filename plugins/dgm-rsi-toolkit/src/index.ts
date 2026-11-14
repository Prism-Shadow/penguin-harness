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
        id: "dgm-rsi-toolkit.card",
        title: "DGM RSI Toolkit",
        titleZh: "DGM 自进化工具包",
        descriptionZh:
          "DGM RSI 工具包：维护编码智能体变体的档案，按得分与多样性选择父代，让新的子智能体会话修改 Target 的 Skill 文件，每个候选都在冻结的 Benchmark 上测量。",
        shortDescription: "DGM RSI Toolkit: open-ended, archive-based self-improvement of a coding agent.",
        shortDescriptionZh: "DGM RSI 工具包：档案式开放式自进化。",
        category: "rsi",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            "Read dgm-rsi-toolkit and demonstrate Darwin Gödel Machine self-improvement in this Workspace: create a summary_writer agent, seed its archive, run two rounds of parent selection with one child per round, and report the baseline score, the best score and the archive tree.",
          promptZh:
            "读取 dgm-rsi-toolkit，在这个 Workspace 里演示 Darwin Gödel Machine 自进化：创建 summary_writer 智能体、播种档案、跑两轮父代选择（每轮一个子代），报告基线分、最佳分与档案树。",
          skills: ["dgm-rsi-toolkit"],
        },
        references: [
          "https://arxiv.org/abs/2505.22954",
          "https://sakana.ai/dgm",
          "https://github.com/jennyzzt/dgm",
        ],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "dgm-rsi-toolkit.skill.dgm-rsi-toolkit",
        name: "dgm-rsi-toolkit",
        path: "skills/dgm-rsi-toolkit",
      },
    ],
  },
})
export class DgmRsiToolkitPlugin {}

export default { modules: [DgmRsiToolkitPlugin] } satisfies Plugin;
