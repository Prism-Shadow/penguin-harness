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
        id: "trace-lookup.card",
        title: "Trace Lookup",
        titleZh: "Trace 查询",
        descriptionZh:
          "从会话的 Trace 文件里精确查回更早的对话：压缩或切换模型之后，需要某个已不在上下文里的细节时使用。",
        shortDescription: "Look up earlier conversation in a Trace file, precisely.",
        shortDescriptionZh: "在 Trace 文件里精确查回更早的对话。",
        category: "office-productivity",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Find the Trace file of my previous conversation with you and quote, exactly, the first thing I asked there.",
          promptZh: "找到我和你上一次对话的 Trace 文件，原文引用我在那次对话里问的第一句话。",
          skills: ["trace-lookup"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      { id: "trace-lookup.skill.trace-lookup", name: "trace-lookup", path: "skills/trace-lookup" },
    ],
  },
})
export class TraceLookupPlugin {}

export default { modules: [TraceLookupPlugin] } satisfies Plugin;
