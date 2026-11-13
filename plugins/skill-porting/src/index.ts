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
        id: "skill-porting.card",
        title: "External Plugin Porting",
        titleZh: "外部插件移植",
        descriptionZh:
          "审阅每个文件后从外部生态移植：把 Skill 装进本 Agent 的 agent_state/skills/（Claude Code 插件市场、Codex 插件仓库、skills.sh 注册名、GitHub 仓库、本地文件夹），或把整个插件（Codex 或 Claude Code 插件、Skill 仓库、GitHub 仓库中的文件夹）转成 PenguinHarness 插件包，用 penguin plugin install 装到服务端。",
        shortDescription: "Port external skills into this agent, or plugins onto the server.",
        shortDescriptionZh: "把外部 Skill 移植进本 Agent，或把外部插件移植到服务端。",
        category: "ai-app-development",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Show me the skills available in the Claude Code plugin marketplace and recommend two that would suit this agent. Do not install anything yet.",
          promptZh:
            "列出 Claude Code 插件市场里可移植的技能，推荐两个适合这个 Agent 的。先不要安装任何东西。",
          skills: ["skill-porting"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "skill-porting.skill.plugin-porting",
        name: "plugin-porting",
        path: "skills/plugin-porting",
      },
      {
        id: "skill-porting.skill.skill-porting",
        name: "skill-porting",
        path: "skills/skill-porting",
      },
    ],
  },
})
export class SkillPortingPlugin {}

export default { modules: [SkillPortingPlugin] } satisfies Plugin;
