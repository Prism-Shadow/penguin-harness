import { Component, type Plugin } from "@prismshadow/penguin-core/plugin";

@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "party-charades.card",
        title: "Party Charades",
        titleZh: "派对猜词",
        descriptionZh: "两队轮流看词比划，限时猜词计分。",
        shortDescription: "Pass one screen between two teams for timed rounds of charades.",
        shortDescriptionZh: "两队轮流看词比划，限时猜词计分。",
        category: "entertainment",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt: "Show me how to get started with Party Charades in the App Center.",
          promptZh: "带我从应用中心打开派对猜词，试用它的主要功能。",
        },
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "party-charades.workbench.party-charades",
        name: "party-charades",
        path: "workbenches/party-charades",
      },
    ],
  },
})
export class PartyCharadesPlugin {}

export default { modules: [PartyCharadesPlugin] } satisfies Plugin;
