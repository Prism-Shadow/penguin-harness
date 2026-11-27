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
        id: "agent-company-proposals.card",
        title: "Agent Company Proposals",
        titleZh: "公司提案与路线图",
        descriptionZh:
          "公司提案与路线图的协议（Project 须先装上 company-proposals 插件），合为一个 Skill，按角色分节，任何员工都照做——不设专门岗位：作者写一份短小、抽象、可逐段评论的提案并按反馈修订；实施者同时在提案分支上实施、向 dev 开 PR 并反馈；测试者分批测试 dev 分支；路线图成员与主持人把讨论室的讨论变成获批的条目。插件会自动装到写或做提案的员工上。",
        shortDescription:
          "The proposal and roadmap protocol for company mode: write, build, test, plan — any employee.",
        shortDescriptionZh: "公司模式的提案与路线图协议：写、做、测、规划——任何员工都可以。",
        category: "office-productivity",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            "Explain how a proposal moves through this organization — who may start one, how the author builds it or hands the build to a colleague, how a person comments and approves — and show the penguin org proposal commands at each step.",
          promptZh:
            "说明一份提案在这个组织里怎么流转——谁可以发起、作者怎么自己实施或交给同事、人怎么评论与认可——并给出每一步要用的 penguin org proposal 命令。",
          skills: ["penguin-proposal"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "agent-company-proposals.skill.penguin-proposal",
        name: "penguin-proposal",
        path: "skills/penguin-proposal",
      },
    ],
  },
})
export class AgentCompanyProposalsPlugin {}

export default { modules: [AgentCompanyProposalsPlugin] } satisfies Plugin;
