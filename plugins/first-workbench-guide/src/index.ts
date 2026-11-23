import { Component, type Plugin } from "@prismshadow/penguin-core/plugin";

@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "first-workbench-guide.card",
        title: "Your first workbench",
        titleZh: "我的第一个工作台",
        descriptionZh: "选择模型，和 Agent 谈谈手头的任务，把对话做成可以安装和测试的清单工作台。",
        shortDescription: "Turn a conversation about your task into a working checklist.",
        shortDescriptionZh: "把你和 Agent 的对话做成自己的任务清单。",
        category: "utilities",
        icon: "icon.svg",
        preinstall: true,
        quickStart: {
          prompt:
            "Help me start Your first workbench in Settings and turn a task into a checklist.",
          promptZh: "带我在设置中开始「我的第一个工作台」引导，把手头的任务做成清单。",
        },
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "first-workbench-guide.workbench.guide",
        name: "first-workbench-guide",
        path: "workbenches/first-workbench-guide",
      },
    ],
  },
})
export class FirstWorkbenchGuidePlugin {}
export default { modules: [FirstWorkbenchGuidePlugin] } satisfies Plugin;
