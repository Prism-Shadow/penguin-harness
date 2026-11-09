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
        shortDescription: "Author Bento slide decks.",
        shortDescriptionZh: "制作 Bento 幻灯片。",
        category: "office-productivity",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Make a three-slide Bento deck in this Workspace introducing PenguinHarness: a title slide, what it does, and how to get started.",
          promptZh:
            "在当前工作区做一份三页的 Bento 幻灯片介绍 PenguinHarness：标题页、它能做什么、如何上手。",
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
  },
})
export class UseBentoSlidesPlugin {}

export default { modules: [UseBentoSlidesPlugin] } satisfies Plugin;
