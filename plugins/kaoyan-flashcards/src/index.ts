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
        id: "kaoyan-flashcards.card",
        title: "Kaoyan Flashcards",
        titleZh: "考研记忆卡",
        descriptionZh:
          "考研公共课与专业课的题库、刷题与背诵工作台：内置 295 道示例题和 9 篇背诵资料，按间隔排期复习，可导入 PDF、Word 和文本。",
        shortDescription: "Kaoyan question bank and spaced review.",
        shortDescriptionZh: "考研题库、间隔复习与背诵资料。",
        category: "utilities",
        icon: "icon.svg",
        // Installed from the library on demand: no Agent gets it at creation.
        preinstall: false,
        quickStart: {
          prompt:
            "Add a Management deck to Kaoyan Flashcards: 20 single-choice questions on organisational behaviour, each with a one-sentence explanation. Tell me when to open the Kaoyan Flashcards tab.",
          promptZh:
            "给考研记忆卡加一个「管理学」题库：20 道组织行为学单选题，每题附一句解析。做好后告诉我打开「考研记忆卡」标签页。",
        },
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "kaoyan-flashcards.workbench.kaoyan-flashcards",
        name: "kaoyan-flashcards",
        path: "workbenches/kaoyan-flashcards",
      },
    ],
  },
})
export class KaoyanFlashcardsPlugin {}

export default { modules: [KaoyanFlashcardsPlugin] } satisfies Plugin;
