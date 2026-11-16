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
        id: "agent-company.card",
        title: "Agent Company",
        titleZh: "智能体公司",
        descriptionZh:
          "把 Project 里的 Agent 组织成一家公司：先与用户一问一答地创建组织，再是每个工位会话与工单会话都遵循的员工协议（触发块、工单看板、频道礼仪、预算、重负载或不可逆的事先向董事会请示），以及 CEO、人事与财务的操作手册——使命拆解为工单、招募与日程、预算与成本巡检——还有科研协议（在董事会批准的资源额度内跑 autoresearch 式实验循环、作者与审稿人对抗评审），以及让数字分身在真人之间传话的镜像协议。",
        shortDescription:
          "Company setup plus the employee, CEO, HR, finance, research and mirror playbooks.",
        shortDescriptionZh: "创建组织，以及员工、CEO、人事、财务、科研、镜像公司的操作手册。",
        category: "office-productivity",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            "Create a company-mode organization for this Project: ask me for its id, name, mission, shared workspace, model and CEO budget one question at a time, confirm the whole thing with me, then create it.",
          promptZh:
            "为这个 Project 创建一个公司模式的组织：一次问我一个问题，收齐它的 id、名称、使命、共享工作区、模型和 CEO 预算，整体向我确认后再创建。",
          skills: ["company-setup"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      { id: "agent-company.skill.company-ceo", name: "company-ceo", path: "skills/company-ceo" },
      {
        id: "agent-company.skill.company-employee",
        name: "company-employee",
        path: "skills/company-employee",
      },
      {
        id: "agent-company.skill.company-finance",
        name: "company-finance",
        path: "skills/company-finance",
      },
      { id: "agent-company.skill.company-hr", name: "company-hr", path: "skills/company-hr" },
      {
        id: "agent-company.skill.company-mirror",
        name: "company-mirror",
        path: "skills/company-mirror",
      },
      {
        id: "agent-company.skill.company-research",
        name: "company-research",
        path: "skills/company-research",
      },
      {
        id: "agent-company.skill.company-setup",
        name: "company-setup",
        path: "skills/company-setup",
      },
    ],
  },
})
export class AgentCompanyPlugin {}

export default { modules: [AgentCompanyPlugin] } satisfies Plugin;
