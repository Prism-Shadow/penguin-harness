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
        id: "use-claude-code.card",
        title: "Remote Claude Code",
        titleZh: "远程操控 Claude Code",
        shortDescription: "Run Claude Code on remote hosts over SSH.",
        shortDescriptionZh:
          "在远程主机上通过 SSH 运行 Claude Code（持久会话 / headless / tmux 交互 / 多轮续接）。",
        category: "software-development",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            "Check whether ssh and the claude CLI are available on this machine, then show the exact commands you would use to run a headless Claude Code task on a remote host.",
          promptZh:
            "检查这台机器上 ssh 和 claude CLI 是否可用，然后给出在远程主机上以无界面方式运行一次 Claude Code 任务的具体命令。",
          skills: ["remote-claude-code"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "use-claude-code.skill.remote-claude-code",
        name: "remote-claude-code",
        path: "skills/remote-claude-code",
      },
    ],
  },
})
export class UseClaudeCodePlugin {}

export default { modules: [UseClaudeCodePlugin] } satisfies Plugin;
