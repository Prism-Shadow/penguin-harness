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
        id: "english-workbench.card",
        title: "English Learning Workbench",
        titleZh: "英语学习工作台",
        descriptionZh:
          "英语学习工作台：名著原文点读、新闻与 TED 导读、粘贴文章精读、可选的每日外刊，配词句库与间隔复习、跟读录音和考试微练。",
        shortDescription: "A daily desk for reading English.",
        shortDescriptionZh: "点读、跟读、词句库与每日练习。",
        // TODO: `learning-life` once the category exists (https://github.com/Prism-Shadow/penguin-harness/pull/1580).
        category: "office-productivity",
        icon: "icon.svg",
        // Installed from the library on demand: no Agent gets it at creation.
        preinstall: false,
        quickStart: {
          prompt:
            "Add a fourth book to the English workbench's classics: two passages from the public-domain text of Jane Eyre, with annotated words and a Chinese translation, in the same format as the other books.",
          promptZh:
            "在英语学习工作台的「名著轻阅读」里加第四本书：《简·爱》公版原文里的两段，配标注词和中文译文，格式和其他书一样。",
        },
      },
    ],
    "PluginLibraryModule.workbenches": [
      { id: "english-workbench.workbench.english", name: "english", path: "workbenches/english" },
    ],
  },
})
export class EnglishWorkbenchPlugin {}

export default { modules: [EnglishWorkbenchPlugin] } satisfies Plugin;
