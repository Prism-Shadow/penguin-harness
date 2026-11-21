import { Component, type Plugin } from "@prismshadow/penguin-core/plugin";

@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "fridge-keeper.card",
        title: "Fridge Keeper",
        titleZh: "冰箱管家",
        descriptionZh: "按存放位置、数量和保质期管理食材。",
        shortDescription: "Track quantities, storage locations and best-before dates.",
        shortDescriptionZh: "按存放位置、数量和保质期管理食材。",
        category: "utilities",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt: "Show me how to get started with Fridge Keeper in the App Center.",
          promptZh: "带我从应用中心打开冰箱管家，试用它的主要功能。",
        },
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "fridge-keeper.workbench.fridge-keeper",
        name: "fridge-keeper",
        path: "workbenches/fridge-keeper",
      },
    ],
  },
})
export class FridgeKeeperPlugin {}

export default { modules: [FridgeKeeperPlugin] } satisfies Plugin;
