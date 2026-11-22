import { Component, type Plugin } from "@prismshadow/penguin-core/plugin";

@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "tabletop-desk.card",
        title: "Tabletop Desk",
        titleZh: "跑团桌",
        descriptionZh: "记录队员、轮次、骰点与场景笔记。",
        shortDescription: "Track the party, take turns, roll dice and keep scene notes.",
        shortDescriptionZh: "记录队员、轮次、骰点与场景笔记。",
        category: "entertainment",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt: "Show me how to get started with Tabletop Desk in the App Center.",
          promptZh: "带我从应用中心打开跑团桌，试用它的主要功能。",
        },
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "tabletop-desk.workbench.tabletop-desk",
        name: "tabletop-desk",
        path: "workbenches/tabletop-desk",
      },
    ],
  },
})
export class TabletopDeskPlugin {}

export default { modules: [TabletopDeskPlugin] } satisfies Plugin;
