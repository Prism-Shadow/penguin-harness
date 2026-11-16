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
        id: "agent-development.card",
        title: "Agent Development",
        titleZh: "智能体开发",
        descriptionZh:
          "基于 PenguinHarness 的智能体开发：依据需求初始化智能体、用 SDK 构建应用或经 Agent API 接入智能体、搭建 Workbench（智能体自己维护的、对话旁的页面）、经统一的 LLM API 调用任意模型、管理模型与密钥、编排智能体/会话/成本/定时任务。",
        shortDescription:
          "Agent setup, SDK, Agent API, workbenches, LLM API, config and orchestration.",
        shortDescriptionZh: "智能体初始化、SDK、Agent API、Workbench、LLM API、配置与编排。",
        category: "ai-app-development",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Use the penguin CLI to list the agents in this Project and the five most recent sessions, then tell me in one line each what every agent is for.",
          promptZh:
            "用 penguin CLI 列出当前 Project 里的 Agent 和最近五个会话，再用一句话说明每个 Agent 是做什么的。",
          skills: ["penguin-orchestration"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "agent-development.skill.agent-initialization",
        name: "agent-initialization",
        path: "skills/agent-initialization",
      },
      {
        id: "agent-development.skill.penguin-config",
        name: "penguin-config",
        path: "skills/penguin-config",
      },
      {
        id: "agent-development.skill.penguin-orchestration",
        name: "penguin-orchestration",
        path: "skills/penguin-orchestration",
      },
      {
        id: "agent-development.skill.penguin-plugin",
        name: "penguin-plugin",
        path: "skills/penguin-plugin",
      },
      {
        id: "agent-development.skill.penguin-sdk",
        name: "penguin-sdk",
        path: "skills/penguin-sdk",
      },
      {
        id: "agent-development.skill.unified-llm-api",
        name: "unified-llm-api",
        path: "skills/unified-llm-api",
      },
    ],
  },
})
export class AgentDevelopmentPlugin {}

export default { modules: [AgentDevelopmentPlugin] } satisfies Plugin;
