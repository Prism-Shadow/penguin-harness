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
        id: "skillweaver-rsi-toolkit.card",
        title: "SkillWeaver RSI Toolkit",
        titleZh: "SkillWeaver 自进化工具包",
        descriptionZh:
          "SkillWeaver RSI 工具包：按论文《SkillWeaver: Web Agents can Self-Improve by Discovering and Honing Skills》（Zheng 等，2025，https://arxiv.org/abs/2504.07079）——智能体自主探索网站，提出值得掌握的技能并练习，把成功的技能打磨成经过测试、可复用的 API 脚本，存入技能库供之后的网页任务调用。自成一体：自行创建 Target 的技能库、运行练习循环、评测每个单元、写入评估中心的记分板。",
        shortDescription: "SkillWeaver RSI Toolkit: hone website skills into tested APIs.",
        shortDescriptionZh: "SkillWeaver RSI 工具包：把网站技能打磨成经过测试的 API。",
        category: "rsi",
        preinstall: false,
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Use the `skillweaver-rsi-toolkit` Skill to run SkillWeaver on an agent of this Project: ask me for the Test Agent and the website to practise on, explore it at the smoke budget with the live-site safety rules on, change nothing until I agree to the plan, and report the APIs learned and how each was tested.",
          promptZh:
            "使用 `skillweaver-rsi-toolkit` 技能在本 Project 的一个智能体上运行 SkillWeaver：先问我被测智能体和要练习的网站，以冒烟预算并开启真实网站安全规则进行探索，在我同意计划前不做任何改动，最后报告学到的 API 以及每个 API 的测试情况。",
          skills: ["skillweaver-rsi-toolkit"],
        },
        references: [
          "https://arxiv.org/abs/2504.07079",
          "https://github.com/OSU-NLP-Group/SkillWeaver",
        ],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "skillweaver-rsi-toolkit.skill.skillweaver-rsi-toolkit",
        name: "skillweaver-rsi-toolkit",
        path: "skills/skillweaver-rsi-toolkit",
      },
    ],
  },
})
export class SkillWeaverRsiToolkitPlugin {}

export default { modules: [SkillWeaverRsiToolkitPlugin] } satisfies Plugin;
