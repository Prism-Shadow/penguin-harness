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
        id: "piglet-stickers.card",
        title: "Piggy Sticker World",
        titleZh: "猪猪的摸鱼小世界",
        descriptionZh:
          "贴纸造景小游戏：208 张小贴纸、13 个场景、10 个主题关卡，随手摆一摆就是自己的一个小世界。",
        shortDescription: "Arrange cute stickers into scenes.",
        shortDescriptionZh: "摆贴纸、换场景、闯关卡的造景小游戏。",
        category: "entertainment",
        icon: "icon.svg",
        // Installed from the library on demand: no Agent gets it at creation.
        preinstall: false,
        quickStart: {
          prompt:
            "Add a new scene called Starry Terrace to Piggy Sticker World, drawn in the same style as the other scenes. Tell me when to open the tab.",
          promptZh:
            "给猪猪的摸鱼小世界加一个新场景「星空露台」，画法和其他场景保持一致。做好后告诉我打开标签页。",
        },
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "piglet-stickers.workbench.piglet-stickers",
        name: "piglet-stickers",
        path: "workbenches/piglet-stickers",
      },
    ],
  },
})
export class PigletStickersPlugin {}

export default { modules: [PigletStickersPlugin] } satisfies Plugin;
