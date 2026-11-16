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
        id: "agent-evaluation.card",
        title: "Agent Evaluation",
        titleZh: "智能体评测",
        descriptionZh:
          "Agent 评估：为智能体设计并校准能力 Benchmark（或导入已发布的 Benchmark 包），并逐题隔离执行、私下评分——默认 RSI 工具包的优化循环就以这些测量为准。",
        shortDescription: "Design Benchmarks, run and score agent evaluations.",
        shortDescriptionZh: "设计 Benchmark，执行并评分智能体评测。",
        category: "ai-app-development",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "List the Benchmark packages in Prism-Shadow/penguin-harness-benchmark and tell me in one line each what they measure. Import nothing until I pick one.",
          promptZh:
            "列出 Prism-Shadow/penguin-harness-benchmark 里的 Benchmark 包，每个用一句话说明它测什么。我选定之前不要导入任何一个。",
          skills: ["benchmark-design"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "agent-evaluation.skill.agent-evaluation",
        name: "agent-evaluation",
        path: "skills/agent-evaluation",
      },
      {
        id: "agent-evaluation.skill.benchmark-design",
        name: "benchmark-design",
        path: "skills/benchmark-design",
      },
    ],
  },
})
export class AgentEvaluationPlugin {}

export default { modules: [AgentEvaluationPlugin] } satisfies Plugin;
