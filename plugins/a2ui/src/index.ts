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
        id: "a2ui.card",
        title: "A2UI Interactive Answers",
        titleZh: "A2UI 交互式回答",
        descriptionZh:
          "让模型输出更易读的富文本组件：选项、表单、分步操作、提示框、Mermaid 图、由数据绘制的基础统计图（折线、面积、柱状、饼图、散点、直方图或仪表），以及基于这些统计图构建的一眼可读的小组件（天气卡片、用仪表展示额度余量、预算或任务进度的指标面板、系统资源面板），外加实时时钟与倒计时，以围栏代码块的形式写在普通 Markdown 回复里，Web App 用自己的组件渲染，其他界面显示为纯文本；用户的选择以普通文字填入输入框。附带中英文的 STE 风格写作规则、两个把天气查询和系统快照直接生成组件块的脚本，以及一个检查脚本：发送前校验每个组件、给草稿打分并打印自审清单。",
        shortDescription:
          "Choices, forms, steps, callouts, diagrams and widgets in replies, with a checker.",
        shortDescriptionZh: "在回复里使用选项、表单、步骤、提示框、图表和小组件，并自带检查脚本。",
        category: "office-productivity",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Ask me which of three weekend plans I prefer as a choice block, then show the one I pick as a short procedure in steps.",
          promptZh:
            "用选项组件问我三个周末计划中更喜欢哪一个，再把我选中的那个写成一份简短的分步操作。",
          skills: ["a2ui"],
        },
      },
    ],
    "PluginLibraryModule.skills": [{ id: "a2ui.skill.a2ui", name: "a2ui", path: "skills/a2ui" }],
  },
})
export class A2uiPlugin {}

export default { modules: [A2uiPlugin] } satisfies Plugin;
