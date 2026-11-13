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
        id: "infrarsi-rsi-toolkit.card",
        title: "InfraRSI RSI Toolkit",
        titleZh: "InfraRSI 自进化工具包",
        descriptionZh:
          "InfraRSI RSI 工具包：按固定 commit 运行上游 InfraRSI 引擎，每个搜索请求交给新的子智能体回答，只报告与原训练任务对照验证通过的提速改动。",
        shortDescription: "InfraRSI RSI Toolkit: a faster training job, verified.",
        shortDescriptionZh: "InfraRSI RSI 工具包：验证过的训练提速。",
        category: "rsi",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            "Read infrarsi-rsi-toolkit and make the training job in this Workspace faster with InfraRSI: agree the contract with me before the search, and change no code until I say so.",
          promptZh:
            "读取 infrarsi-rsi-toolkit，用 InfraRSI 加速这个 Workspace 里的训练任务：搜索前先和我确认约定，我同意之前不要改代码。",
          skills: ["infrarsi-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2611.11558", "https://github.com/TokenRhythm/InfraRSI"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "infrarsi-rsi-toolkit.skill.infrarsi-rsi-toolkit",
        name: "infrarsi-rsi-toolkit",
        path: "skills/infrarsi-rsi-toolkit",
      },
    ],
  },
})
export class InfrarsiRsiToolkitPlugin {}

export default { modules: [InfrarsiRsiToolkitPlugin] } satisfies Plugin;
