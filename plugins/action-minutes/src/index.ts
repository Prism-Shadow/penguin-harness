import { Component, type Plugin } from "@prismshadow/penguin-core/plugin";

@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "action-minutes.card",
        title: "Action Minutes",
        titleZh: "会议行动簿",
        descriptionZh: "整理会议决定，按负责人和截止日期跟进行动项。",
        shortDescription: "Record decisions and follow up on action items by owner and due date.",
        shortDescriptionZh: "整理会议决定，按负责人和截止日期跟进行动项。",
        category: "utilities",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt: "Show me how to get started with Action Minutes in the App Center.",
          promptZh: "带我从应用中心打开会议行动簿，试用它的主要功能。",
        },
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "action-minutes.workbench.action-minutes",
        name: "action-minutes",
        path: "workbenches/action-minutes",
      },
    ],
  },
})
export class ActionMinutesPlugin {}

export default { modules: [ActionMinutesPlugin] } satisfies Plugin;
