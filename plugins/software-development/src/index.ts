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
        id: "software-development.card",
        title: "Software Development",
        titleZh: "软件开发",
        descriptionZh:
          "端到端的软件开发——面向真实任务的软件工程实践准则，加上生成网页与应用界面的 Penguin 视觉规范。",
        shortDescription: "Engineering practice and web UI defaults in one plugin.",
        shortDescriptionZh: "软件工程实践与网页视觉规范合一。",
        category: "software-development",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Build a single-file landing page, index.html, in this Workspace for a made-up note-taking app, with a light and a dark theme.",
          promptZh:
            "在当前工作区为一个虚构的笔记应用做一个单文件落地页 index.html，带浅色和深色两套主题。",
          skills: ["web-design"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "software-development.skill.software-engineering",
        name: "software-engineering",
        path: "skills/software-engineering",
      },
      {
        id: "software-development.skill.web-design",
        name: "web-design",
        path: "skills/web-design",
      },
    ],
  },
})
export class SoftwareDevelopmentPlugin {}

export default { modules: [SoftwareDevelopmentPlugin] } satisfies Plugin;
