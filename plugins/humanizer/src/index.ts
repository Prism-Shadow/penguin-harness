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
        id: "humanizer.card",
        title: "Humanizer",
        titleZh: "去 AI 味写作",
        shortDescription: "Strip AI-writing tells from prose in any language.",
        shortDescriptionZh: "去除文本的 AI 味，把行文改成书籍、报纸、百科式的风格，任何语言通用。",
        category: "office-productivity",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            'Rewrite this so it reads like edited human writing: "In today\'s fast-paced world, it is important to note that leveraging cutting-edge solutions can unlock a myriad of opportunities and drive meaningful impact across diverse domains."',
          promptZh:
            "把这段话改写成像经过编辑的人写的文字：「在当今快速发展的时代，值得注意的是，借助前沿解决方案能够解锁无数机遇，并在多元领域推动有意义的影响。」",
          skills: ["humanizer"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      { id: "humanizer.skill.humanizer", name: "humanizer", path: "skills/humanizer" },
    ],
  },
})
export class HumanizerPlugin {}

export default { modules: [HumanizerPlugin] } satisfies Plugin;
