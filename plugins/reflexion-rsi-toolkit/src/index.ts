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
        id: "reflexion-rsi-toolkit.card",
        title: "Reflexion RSI Toolkit",
        titleZh: "Reflexion 自进化工具包",
        descriptionZh:
          "Reflexion RSI 工具包：按论文《Reflexion》（Shinn 等，2023，https://arxiv.org/abs/2303.11366）的流程运行——每次测量后由 Reflector 把分数矩阵与失败用例的公开题面提炼成一条书面反思，存入 Target 的情景缓存并在下一轮试验前读取，保留得分最高的试验。自成一体：自行创建 Target 的反思槽、自行评测每个单元、写入评估中心的记分板。",
        shortDescription: "Reflexion RSI Toolkit: improve trials with written reflections.",
        shortDescriptionZh: "Reflexion RSI 工具包：以书面反思改进逐轮试验。",
        category: "rsi",
        icon: "icon.svg",
        preinstall: false,
        quickStart: {
          prompt:
            "Use the `reflexion-rsi-toolkit` Skill to reproduce Reflexion on the precise-summary demo task that ships with it: create the Target agent `summary_writer`, measure the base State, run one Reflector and one more trial, and report both trials' scores, the reflection and the best snapshot.",
          promptZh:
            "使用 `reflexion-rsi-toolkit` 技能在它自带的「精确摘要」演示任务上复现 Reflexion：创建 Target 智能体 `summary_writer`，测量基线 State，跑一次 Reflector 与一轮缓冲试验，报告两轮分数、反思文本与最佳快照。",
          skills: ["reflexion-rsi-toolkit"],
        },
        references: ["https://arxiv.org/abs/2303.11366", "https://github.com/noahshinn/reflexion"],
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "reflexion-rsi-toolkit.skill.reflexion-rsi-toolkit",
        name: "reflexion-rsi-toolkit",
        path: "skills/reflexion-rsi-toolkit",
      },
    ],
  },
})
export class ReflexionRsiToolkitPlugin {}

export default { modules: [ReflexionRsiToolkitPlugin] } satisfies Plugin;
