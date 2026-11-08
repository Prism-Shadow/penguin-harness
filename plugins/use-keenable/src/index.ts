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
        id: "use-keenable.card",
        title: "Keenable Search",
        titleZh: "Keenable 搜索",
        shortDescription: "Keyless web search and page reading via Keenable.",
        shortDescriptionZh: "用 Keenable 做网络搜索与页面读取，无需 API key。",
        category: "office-productivity",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            "Search the web for the latest PenguinHarness release and summarize its three most important changes, with links to the sources.",
          promptZh:
            "在网上搜索 PenguinHarness 的最新版本，概括其中最重要的三项改动，并附上来源链接。",
          skills: ["keenable"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      { id: "use-keenable.skill.keenable", name: "keenable", path: "skills/keenable" },
    ],
    "PluginLibraryModule.mcpServers": [
      {
        id: "use-keenable.mcp.keenable",
        name: "keenable",
        config: { url: "https://api.keenable.ai/mcp-public" },
      },
    ],
  },
})
export class UseKeenablePlugin {}

export default { modules: [UseKeenablePlugin] } satisfies Plugin;
