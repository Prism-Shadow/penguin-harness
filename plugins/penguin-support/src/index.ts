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
        id: "penguin-support.card",
        title: "PenguinHarness Q&A Assistant",
        titleZh: "PenguinHarness 问答助手",
        descriptionZh: "PenguinHarness 产品客服：问题列表、对话弹窗，以及依据文档和源码的解答。",
        shortDescription: "Product questions, sourced answers and a support workbench.",
        shortDescriptionZh: "产品问答、来源引用与客服工作台。",
        category: "office-productivity",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            "How do I create an agent and choose its model in PenguinHarness? Cite the official docs.",
          promptZh: "如何在 PenguinHarness 中新建智能体并选择模型？请引用官方文档。",
          skills: ["penguin-support"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "penguin-support.skill.penguin-support",
        name: "penguin-support",
        path: "skills/penguin-support",
      },
    ],
    "PluginLibraryModule.workbenches": [
      { id: "penguin-support.workbench.support", name: "support", path: "workbenches/support" },
    ],
  },
})
export class PenguinSupportPlugin {}

export default { modules: [PenguinSupportPlugin] } satisfies Plugin;
