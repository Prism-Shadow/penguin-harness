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
        id: "use-bento-slides.card",
        title: "Bento Slides",
        titleZh: "Bento 幻灯片",
        descriptionZh:
          "Bento 幻灯片：AI PPT 工作台里，你在编辑器中修改文稿的同时，Agent 修改同一份文稿，双方的修改都会保留；Skill 也能在工作区里编写自成一体的 .bento.html 文稿。",
        shortDescription: "Edit slide decks with the Agent, live.",
        shortDescriptionZh: "和 Agent 一起实时编辑幻灯片。",
        category: "utilities",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Make a five-slide deck in the Slides workbench introducing PenguinHarness: a cover, what it does, how it improves itself (with a chart), how to get started, and a closing slide. Tell me when to open the Slides tab.",
          promptZh:
            "在幻灯片工作台里做一份五页的文稿介绍 PenguinHarness：封面、它能做什么、它如何自我改进（配一张图表）、如何上手、结尾页。做好后告诉我打开「幻灯片」标签页。",
          skills: ["bento-slides"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "use-bento-slides.skill.bento-slides",
        name: "bento-slides",
        path: "skills/bento-slides",
      },
    ],
    "PluginLibraryModule.workbenches": [
      { id: "use-bento-slides.workbench.slides", name: "slides", path: "workbenches/slides" },
    ],
  },
})
export class UseBentoSlidesPlugin {}

export default { modules: [UseBentoSlidesPlugin] } satisfies Plugin;
