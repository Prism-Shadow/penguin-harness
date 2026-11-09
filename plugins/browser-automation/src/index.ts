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
        id: "browser-automation.card",
        title: "Browser Automation",
        titleZh: "浏览器自动化",
        descriptionZh:
          "用 penguin browser 在 shell 中驱动 Agent 浏览器——桌面应用的内置浏览器或用户自己的 Chrome，由用户选择——以简化 HTML 或纯文本读取页面，用 JavaScript 以及可信的点击与输入操作页面，提取订单、搜索结果等结构化数据；登录用的是用户自己的账号。",
        shortDescription:
          "Read pages, act and extract data in the built-in browser or your Chrome.",
        shortDescriptionZh: "在内置浏览器或你的 Chrome 中读取页面、执行操作、提取数据。",
        category: "office-productivity",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Open news.ycombinator.com in the agent browser and list the top five stories as a table of title, points and link.",
          promptZh:
            "在 Agent 浏览器中打开 news.ycombinator.com，把排名前五的帖子整理成表格：标题、分数和链接。",
          skills: ["browser-automation"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "browser-automation.skill.browser-automation",
        name: "browser-automation",
        path: "skills/browser-automation",
      },
    ],
  },
})
export class BrowserAutomationPlugin {}

export default { modules: [BrowserAutomationPlugin] } satisfies Plugin;
