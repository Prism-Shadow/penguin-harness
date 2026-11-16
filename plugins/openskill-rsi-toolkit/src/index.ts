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
        id: "openskill-rsi-toolkit.card",
        title: "OpenSkill RSI Toolkit",
        titleZh: "OpenSkill 自进化工具包",
        descriptionZh:
          "OpenSkill RSI：检索独立知识，以虚拟测试反馈修订可复用技能，冻结最终技能库后评测项目内的 Benchmark。",
        shortDescription: "OpenSkill RSI Toolkit: learn skills through research and virtual tests.",
        shortDescriptionZh: "OpenSkill RSI 工具包：通过检索与虚拟测试学习技能。",
        category: "rsi",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Use openskill-rsi-toolkit to run OpenSkill on a published Benchmark in this Project with a fresh Target and the current model, including a baseline comparison; ask which Benchmark if unspecified.",
          promptZh:
            "使用 openskill-rsi-toolkit，以当前模型和新建 Target 在本项目已发布的 Benchmark 上运行 OpenSkill 并比较基线；若未指定 Benchmark，请先询问。",
          skills: ["openskill-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2606.06741"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "openskill-rsi-toolkit.skill.openskill-rsi-toolkit",
        name: "openskill-rsi-toolkit",
        path: "skills/openskill-rsi-toolkit",
      },
    ],
  },
})
export class OpenskillRsiToolkitPlugin {}

export default { modules: [OpenskillRsiToolkitPlugin] } satisfies Plugin;
