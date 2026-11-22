import { Component, type Plugin } from "@prismshadow/penguin-core/plugin";

@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "daily-draw.card",
        title: "Daily Draw",
        titleZh: "每日一签",
        descriptionZh: "每天抽一支签，写一句感想，随时回看。",
        shortDescription: "Draw a daily prompt and keep a short journal alongside past draws.",
        shortDescriptionZh: "每天抽一支签，写一句感想，随时回看。",
        category: "entertainment",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt: "Show me how to get started with Daily Draw in the App Center.",
          promptZh: "带我从应用中心打开每日一签，试用它的主要功能。",
        },
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "daily-draw.workbench.daily-draw",
        name: "daily-draw",
        path: "workbenches/daily-draw",
      },
    ],
  },
})
export class DailyDrawPlugin {}

export default { modules: [DailyDrawPlugin] } satisfies Plugin;
