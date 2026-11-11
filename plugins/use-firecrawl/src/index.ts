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
        id: "use-firecrawl.card",
        title: "Firecrawl Search",
        titleZh: "Firecrawl 搜索",
        shortDescription: "Web search and page scraping via Firecrawl.",
        shortDescriptionZh: "用 Firecrawl 做网络搜索与页面抓取。",
        category: "office-productivity",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Search the web for the latest PenguinHarness release and summarize its three most important changes, with links to the sources.",
          promptZh:
            "在网上搜索 PenguinHarness 的最新版本，概括其中最重要的三项改动，并附上来源链接。",
          skills: ["firecrawl"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      { id: "use-firecrawl.skill.firecrawl", name: "firecrawl", path: "skills/firecrawl" },
    ],
  },
})
export class UseFirecrawlPlugin {}

export default { modules: [UseFirecrawlPlugin] } satisfies Plugin;
