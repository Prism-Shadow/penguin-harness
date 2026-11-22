/**
 * Storage as a plugin (the server half, `.`): the server module that measures the data root and
 * cleans what can be regenerated (`StorageModule`, src/server/), and what the plugin library
 * lists for it.
 *
 * The card says `preinstall: true` (PRFC-0030): every new Project lists the module when it is
 * created, and a server lists it once in the Projects it already has, so the page is there
 * whether or not a Project enables any other plugin. The web half (`./web`, Settings › Storage)
 * and the CLI half (`./cli`, `penguin storage`) are compiled into the Web App and the CLI at build
 * time; this file names neither. Its Skill (`storage`) lets an agent tell the user what takes space
 * through `penguin storage`; removing stays the user's.
 */
import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import { StorageModule } from "./server/module.js";

/**
 * Everything this plugin carries, declared for the plugin library: data only, which `build`
 * writes into `ifaces.json`.
 */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "storage.card",
        title: "Storage",
        titleZh: "存储空间",
        descriptionZh:
          "查看数据根目录占用了多少空间——按类别、按 Project 和 Agent 统计——并清理可以重新生成的内容：孤立的草稿区、临时 Workspace 与工具环境，删除前逐项确认。在应用里是 设置 › 存储空间，在 shell 里是 penguin storage；附带的 Skill 让 Agent 能告诉用户空间被什么占用。",
        shortDescription: "See what the data root holds and clean what can be regenerated.",
        shortDescriptionZh: "查看数据目录占用，清理可以重新生成的内容。",
        category: "office-productivity",
        icon: "icon.svg",
        preinstall: true,
        quickStart: {
          prompt:
            "How much disk space does PenguinHarness use here, what takes the most, and what could be cleaned up?",
          promptZh: "PenguinHarness 在这台机器上占用了多少磁盘空间？哪些占得最多，哪些可以清理？",
          skills: ["storage"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      { id: "storage.skill.storage", name: "storage", path: "skills/storage" },
    ],
  },
})
export class StoragePlugin {}

export default { modules: [StoragePlugin, StorageModule] } satisfies Plugin;
