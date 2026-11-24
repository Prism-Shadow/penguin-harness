/**
 * Task Manager as a plugin (the server half, `.`): the server module that answers the tree of what
 * runs right now (`TaskManagerModule`, src/server/), and what the plugin library lists for it.
 *
 * The card says `preinstall: true` (PRFC-0030): a server module needs it in so many words to be
 * listed for every Project, so the page is there whether or not a Project enables any other plugin.
 * The web half (`./web`, the page itself) is compiled into the Web App at build time; this file
 * names it not. Its Skill (`task-manager`) lets an agent read the same tree in the shell.
 */
import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import { TaskManagerModule } from "./server/module.js";

/**
 * Everything this plugin carries, declared for the plugin library: data only, which `build`
 * writes into `ifaces.json`.
 */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "task-manager.card",
        title: "Task Manager",
        titleZh: "任务管理器",
        descriptionZh:
          "显示正在运行的任务树：页面 → 会话 → 进程。每个页面归集它开出的会话的 Token 总开销，每个进程显示当前的 CPU 与内存占用。在应用里是应用中心的「任务管理器」页，附带的 Skill 让 Agent 能在 shell 里读到同一棵树。",
        shortDescription:
          "See the tree of what runs now — page, session, process — with Tokens, CPU and memory.",
        shortDescriptionZh: "查看正在运行的任务树：页面、会话、进程，以及 Token、CPU 与内存占用。",
        category: "utilities",
        icon: "icon.svg",
        preinstall: true,
        quickStart: {
          prompt:
            "What is running in my Project right now? Group it by the page that opened it, and tell me which process uses the most memory.",
          promptZh: "我的 Project 现在在跑什么？按开出它的页面分组，并告诉我哪个进程占内存最多。",
          skills: ["task-manager"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      { id: "task-manager.skill.task-manager", name: "task-manager", path: "skills/task-manager" },
    ],
  },
})
export class TaskManagerPlugin {}

export default { modules: [TaskManagerPlugin, TaskManagerModule] } satisfies Plugin;
