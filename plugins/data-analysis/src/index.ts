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
        id: "data-analysis.card",
        title: "Data Analysis",
        titleZh: "数据分析",
        shortDescription: "Deliver correct data-analysis artifacts with bounded verification.",
        shortDescriptionZh: "以正确数据语义完成产物并进行有界核查。",
        category: "office-productivity",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Create a CSV of 30 days of made-up daily sales in this Workspace, then analyze it: weekly totals, the best and the worst day, and a line chart saved as sales.png.",
          promptZh:
            "在当前工作区生成一份 30 天的虚构日销售额 CSV，然后分析它：每周合计、最好和最差的一天，并把折线图保存为 sales.png。",
          skills: ["data-analysis"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "data-analysis.skill.data-analysis",
        name: "data-analysis",
        path: "skills/data-analysis",
      },
    ],
  },
})
export class DataAnalysisPlugin {}

export default { modules: [DataAnalysisPlugin] } satisfies Plugin;
