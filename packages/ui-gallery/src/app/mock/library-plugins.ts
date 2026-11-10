/**
 * The library plugins the demo's self-evolution story stands on, read from the packages the
 * product ships (`plugins/<name>/package.json` and `icon.svg`) and the cards they declare: the
 * RSI toolkits, which make up the library's `rsi` category, and the Agent Evaluation plugin they
 * measure through. A card and its detail say what the real plugin says, in both languages, and
 * the start page counts the toolkits from this list as the app counts them from the server's.
 *
 * Each card and each Skill's metadata is spelled here (the card as the plugin's src/index.ts
 * declares it; the Skill as its SKILL.md names, describes and versions it): the gallery does not
 * build the plugins' tables, and the SKILL.md bodies are too large to bundle into every frame for
 * one line each.
 */
import type { PluginItem, SkillMetadataItem } from "@prismshadow/penguin-server/api";
import aceIcon from "../../../../../plugins/ace-rsi-toolkit/icon.svg?raw";
import acePkg from "../../../../../plugins/ace-rsi-toolkit/package.json";
import evaluationIcon from "../../../../../plugins/agent-evaluation/icon.svg?raw";
import evaluationPkg from "../../../../../plugins/agent-evaluation/package.json";
import apeIcon from "../../../../../plugins/ape-rsi-toolkit/icon.svg?raw";
import apePkg from "../../../../../plugins/ape-rsi-toolkit/package.json";
import awmIcon from "../../../../../plugins/awm-rsi-toolkit/icon.svg?raw";
import awmPkg from "../../../../../plugins/awm-rsi-toolkit/package.json";
import defaultIcon from "../../../../../plugins/default-rsi-toolkit/icon.svg?raw";
import defaultPkg from "../../../../../plugins/default-rsi-toolkit/package.json";
import openskillIcon from "../../../../../plugins/openskill-rsi-toolkit/icon.svg?raw";
import openskillPkg from "../../../../../plugins/openskill-rsi-toolkit/package.json";
import oproIcon from "../../../../../plugins/opro-rsi-toolkit/icon.svg?raw";
import oproPkg from "../../../../../plugins/opro-rsi-toolkit/package.json";
import skilladamIcon from "../../../../../plugins/skilladam-rsi-toolkit/icon.svg?raw";
import skilladamPkg from "../../../../../plugins/skilladam-rsi-toolkit/package.json";
import skilloptIcon from "../../../../../plugins/skillopt-rsi-toolkit/icon.svg?raw";
import skilloptPkg from "../../../../../plugins/skillopt-rsi-toolkit/package.json";
import traceIcon from "../../../../../plugins/trace-rsi-toolkit/icon.svg?raw";
import tracePkg from "../../../../../plugins/trace-rsi-toolkit/package.json";

/** The npm fields of a plugin's package.json the library listing reads. */
interface Manifest {
  name: string;
  version: string;
  description: string;
  license?: string;
}

/** The card fields the library listing reads (core's PluginCard). */
type Card = Pick<
  PluginItem,
  "title" | "titleZh" | "descriptionZh" | "shortDescription" | "shortDescriptionZh" | "quickStart"
>;

/**
 * Each plugin's card, as its src/index.ts declares it (`PluginLibraryModule.cards`): the gallery
 * spells it here, as it spells each Skill's metadata below, rather than building the plugins' tables.
 */
const CARDS: Record<string, Card> = {
  "ace-rsi-toolkit": {
    title: "ACE RSI Toolkit",
    titleZh: "ACE 自进化工具包",
    descriptionZh:
      "ACE RSI 工具包：按论文《Agentic Context Engineering》（Zhang 等，2025，https://arxiv.org/abs/2510.04618）的顺序离线算法——Reflector 逐条阅读训练轨迹，Curator 把教训并入 Target 每次任务前都会读的规则手册（playbook），最终手册在冻结的 Benchmark 上测量。自成一体：自行创建 Target 的手册 Skill、自行评测每个单元、写入评估中心的记分板。",
    shortDescription: "ACE RSI Toolkit: evolve a playbook from Traces.",
    shortDescriptionZh: "ACE RSI 工具包：从轨迹进化规则手册。",
    quickStart: {
      prompt:
        "Use the `ace-rsi-toolkit` Skill to run ACE on an agent of this Project: ask me for the Test Agent and the published Benchmark to train on, initialize the playbook, run one epoch at the smoke budget, and report the baseline and final scores.",
      promptZh:
        "使用 `ace-rsi-toolkit` 技能在本 Project 的一个智能体上运行 ACE：先问我被测智能体与用于训练的已发布 Benchmark，初始化规则手册，以冒烟预算跑一个 epoch，报告基线分与最终分。",
      skills: ["ace-rsi-toolkit"],
    },
  },
  "ape-rsi-toolkit": {
    title: "APE RSI Toolkit",
    titleZh: "APE 自进化工具包",
    descriptionZh:
      "APE RSI 工具包：按论文《Large Language Models are Human-Level Prompt Engineers》（Zhou 等，2022，https://arxiv.org/abs/2211.01910）的非迭代前向生成与执行评分——提议者从输入 / 输出示例归纳候选指令，每个候选都在冻结的 Benchmark 上测量，保留最优者。自成一体：自行创建 Target 的指令槽、自行评测每个单元、写入评估中心的记分板。",
    shortDescription: "APE RSI Toolkit: induce an instruction from examples.",
    shortDescriptionZh: "APE RSI 工具包：从示例归纳指令。",
    quickStart: {
      prompt:
        "Reproduce APE (Automatic Prompt Engineer, Zhou et al. 2022) on the house-style brief task that ships with the `ape-rsi-toolkit` Skill: a fresh agent, a 6-case Benchmark, and the score before and after.",
      promptZh:
        "在 `ape-rsi-toolkit` 技能自带的「公司格式简报」任务上复现 APE（Automatic Prompt Engineer，Zhou 等，2022）：新建一个 Agent、一套 6 题的 Benchmark，给我看优化前后的分数。",
      skills: ["ape-rsi-toolkit"],
    },
  },
  "awm-rsi-toolkit": {
    title: "AWM RSI Toolkit",
    titleZh: "AWM 自进化工具包",
    descriptionZh:
      "AWM RSI 工具包：按论文《Agent Workflow Memory》（Wang 等，2024，https://arxiv.org/abs/2409.07429）——从成功轨迹归纳工作流并存入 Target 的记忆，在线（训练流）或离线（给定经验）两种模式，冻结后在 Benchmark 上独立测试。自成一体：自行创建 Target 的工作流记忆、自行评测每个单元、写入评估中心的记分板。",
    shortDescription: "AWM RSI Toolkit: induce workflows from trajectories.",
    shortDescriptionZh: "AWM RSI 工具包：从轨迹归纳工作流。",
    quickStart: {
      prompt:
        "Use the `awm-rsi-toolkit` Skill to run AWM on an agent of this Project: ask me for the Test Agent and the published Benchmark, run the online_train mode over its cases once at the smoke budget, freeze the workflow memory, and report the baseline and final scores.",
      promptZh:
        "使用 `awm-rsi-toolkit` 技能在本 Project 的一个智能体上运行 AWM：先问我被测智能体与已发布的 Benchmark，以冒烟预算按 online_train 模式跑一遍题目，冻结工作流记忆，报告基线分与最终分。",
      skills: ["awm-rsi-toolkit"],
    },
  },
  "default-rsi-toolkit": {
    title: "Default RSI Toolkit",
    titleZh: "默认自进化工具包",
    descriptionZh:
      "默认 RSI 工具包：把「试跑 → 反思 → 提升」的循环做成一个 Skill——依据 Benchmark 的实测结果逐轮改进 Agent，每轮之前自动快照。测量经由 Agent Evaluation 插件的 agent-evaluation Skill 完成。",
    shortDescription: "Default RSI Toolkit: trial, reflect, improve.",
    shortDescriptionZh: "默认 RSI 工具包：试跑、反思、提升。",
    quickStart: {
      prompt:
        "List this Project's Benchmarks with their latest scores, then propose which agent to optimize on which Benchmark and for how many rounds. Wait for my go-ahead before starting.",
      promptZh:
        "列出本 Project 的 Benchmark 和各自最近的分数，再建议用哪个 Benchmark 优化哪个 Agent、跑几轮。等我确认后再开始。",
      skills: ["agent-optimization"],
    },
  },
  "openskill-rsi-toolkit": {
    title: "OpenSkill RSI Toolkit",
    titleZh: "OpenSkill 自进化工具包",
    descriptionZh:
      "OpenSkill RSI：检索独立知识，以虚拟测试反馈修订可复用技能，冻结最终技能库后评测项目内的 Benchmark。",
    shortDescription: "OpenSkill RSI Toolkit: learn skills through research and virtual tests.",
    shortDescriptionZh: "OpenSkill RSI 工具包：通过检索与虚拟测试学习技能。",
    quickStart: {
      prompt:
        "Use openskill-rsi-toolkit to run OpenSkill on a published Benchmark in this Project with a fresh Target and the current model, including a baseline comparison; ask which Benchmark if unspecified.",
      promptZh:
        "使用 openskill-rsi-toolkit，以当前模型和新建 Target 在本项目已发布的 Benchmark 上运行 OpenSkill 并比较基线；若未指定 Benchmark，请先询问。",
      skills: ["openskill-rsi-toolkit"],
    },
  },
  "opro-rsi-toolkit": {
    title: "OPRO RSI Toolkit",
    titleZh: "OPRO 自进化工具包",
    descriptionZh:
      "OPRO RSI 工具包：按论文《Large Language Models as Optimizers》（Yang 等，2023，https://arxiv.org/abs/2309.03409）的流程运行——优化器依据历史指令与分数提出新指令，每个候选都在冻结的 Benchmark 上测量，保留得分最高的指令。自成一体：自行创建 Target 的指令槽、自行评测每个单元、写入评估中心的记分板。",
    shortDescription: "OPRO RSI Toolkit: optimize an instruction from scores.",
    shortDescriptionZh: "OPRO RSI 工具包：由分数优化指令。",
    quickStart: {
      prompt:
        "Use the `opro-rsi-toolkit` Skill to reproduce OPRO on the precise-summary demo task that ships with it: create the Target agent `summary_writer` and the Benchmark `precise-summary`, measure the seed instruction, run 2 steps × 4 proposals, and report the baseline and best scores.",
      promptZh:
        "使用 `opro-rsi-toolkit` 技能在它自带的「精确摘要」演示任务上复现 OPRO：创建 Target 智能体 `summary_writer` 与 Benchmark `precise-summary`，测量种子指令，跑 2 步 × 4 个提案，报告基线分与最佳分。",
      skills: ["opro-rsi-toolkit"],
    },
  },
  "skilladam-rsi-toolkit": {
    title: "SkillAdam RSI Toolkit",
    titleZh: "SkillAdam 自进化工具包",
    descriptionZh:
      "SkillAdam RSI 工具包：组织 benchmark 实验，结合执行轨迹、持续更新的问题记录、配对评测和按方差调整的编辑预算，迭代优化目标 Agent 的技能。",
    shortDescription: "SkillAdam RSI Toolkit: evolve a Skill from execution feedback.",
    shortDescriptionZh: "SkillAdam RSI 工具包：根据执行反馈迭代技能。",
    quickStart: {
      prompt:
        "Read skilladam-rsi-toolkit and run a SkillAdam experiment on the selected benchmark with the requested model and budget.",
      promptZh:
        "读取 skilladam-rsi-toolkit，按指定模型和预算，在选定的 benchmark 上完成 SkillAdam 实验。",
      skills: ["skilladam-rsi-toolkit"],
    },
  },
  "skillopt-rsi-toolkit": {
    title: "SkillOpt RSI Toolkit",
    titleZh: "SkillOpt 自进化工具包",
    descriptionZh:
      "SkillOpt RSI 工具包：通过有界文本编辑、候选评测和跨轮反思优化可复用 Skill，再比较冻结的 baseline 与 final。",
    shortDescription: "SkillOpt RSI Toolkit: bounded Skill edits with score-based selection.",
    shortDescriptionZh: "SkillOpt RSI 工具包：限制编辑幅度，按评分选择技能。",
    quickStart: {
      prompt:
        "Read skillopt-rsi-toolkit and run a SkillOpt experiment on the selected Benchmarks with the requested model and budget.",
      promptZh:
        "读取 skillopt-rsi-toolkit，按指定模型和预算，在选定的 Benchmark 上完成 SkillOpt 实验。",
      skills: ["skillopt-rsi-toolkit"],
    },
  },
  "trace-rsi-toolkit": {
    title: "TRACE RSI Toolkit",
    titleZh: "TRACE 自进化工具包",
    descriptionZh:
      "TRACE RSI 工具包：组织容器内训练与独立评测，对比轨迹修订技能库，按训练分数选择版本后测试。",
    shortDescription: "TRACE RSI Toolkit: evolve skills from contrasting trajectories.",
    shortDescriptionZh: "TRACE RSI 工具包：对比轨迹，进化技能库。",
    quickStart: {
      prompt: "Use TRACE on the selected Project Benchmarks with the requested model and budget.",
      promptZh: "使用 TRACE，按指定模型和预算完成选定 Project Benchmark 的实验。",
      skills: ["trace-rsi-toolkit"],
    },
  },
  "agent-evaluation": {
    title: "Agent Evaluation",
    titleZh: "智能体评测",
    descriptionZh:
      "Agent 评估：为智能体设计并校准能力 Benchmark（或导入已发布的 Benchmark 包），并逐题隔离执行、私下评分——默认 RSI 工具包的优化循环就以这些测量为准。",
    shortDescription: "Design Benchmarks, run and score agent evaluations.",
    shortDescriptionZh: "设计 Benchmark，执行并评分智能体评测。",
    quickStart: {
      prompt:
        "List the Benchmark packages in Prism-Shadow/penguin-harness-benchmark and tell me in one line each what they measure. Import nothing until I pick one.",
      promptZh:
        "列出 Prism-Shadow/penguin-harness-benchmark 里的 Benchmark 包，每个用一句话说明它测什么。我选定之前不要导入任何一个。",
      skills: ["benchmark-design"],
    },
  },
};

/** A library plugin as GET /api/plugins lists one this build ships. */
function libraryPlugin(manifest: Manifest, icon: string, skills: SkillMetadataItem[]): PluginItem {
  const name = manifest.name.replace(/^@[^/]+\//, "");
  return {
    name,
    ...CARDS[name],
    description: manifest.description,
    version: manifest.version,
    package: manifest.name,
    source: "builtin",
    ...(manifest.license ? { license: manifest.license } : {}),
    repository: "https://github.com/Prism-Shadow/penguin-harness",
    skills,
    hooks: [],
    icon,
    mcpServers: [],
  };
}

/** Default frontmatter version for the demo's unchanged Skills. */
const SKILL_VERSION = "2026.10.12.1";

const skill = (name: string, description: string, version = SKILL_VERSION): SkillMetadataItem => ({
  name,
  description,
  version,
});

/** The library's self-evolution toolkits (the `rsi` category), in its order: by name. */
export function rsiToolkitPlugins(): PluginItem[] {
  return [
    libraryPlugin(acePkg, aceIcon, [
      skill(
        "ace-rsi-toolkit",
        "Run ACE (Agentic Context Engineering, Zhang et al. 2025) on an agent the sequential offline way - a Reflector reads each training Trace, a Curator adds the lessons to a playbook of rules the agent reads before every task, and the final playbook is measured on a published Benchmark.",
        "2026.11.05.1",
      ),
    ]),
    libraryPlugin(apePkg, apeIcon, [
      skill(
        "ape-rsi-toolkit",
        "Reproduce APE (Large Language Models are Human-Level Prompt Engineers, Zhou et al. 2022) on an agent and a frozen Benchmark, or on the house-style brief demo task shipped with this Skill: induce instructions from input/output examples, measure each one, keep the best.",
        "2026.11.05.1",
      ),
    ]),
    libraryPlugin(awmPkg, awmIcon, [
      skill(
        "awm-rsi-toolkit",
        "Run AWM (Agent Workflow Memory, Wang et al. 2024) on an agent - induce reusable workflows from its successful trajectories, online over a training stream or offline from supplied experiences, then freeze the workflow memory and measure it on a published Benchmark.",
        "2026.11.05.1",
      ),
    ]),
    libraryPlugin(defaultPkg, defaultIcon, [
      skill(
        "agent-optimization",
        "Improve an Agent State through versioned scores and score-linked Traces from a frozen Benchmark.",
        "2026.11.05.1",
      ),
    ]),
    libraryPlugin(openskillPkg, openskillIcon, [
      skill(
        "openskill-rsi-toolkit",
        "Run OpenSkill on selected Project Benchmarks: research domain knowledge, refine reusable Skills with independent virtual tests, freeze the last revision, then evaluate baseline and final.",
        "2026.10.29.4",
      ),
    ]),
    libraryPlugin(oproPkg, oproIcon, [
      skill(
        "opro-rsi-toolkit",
        "Reproduce OPRO (Large Language Models as Optimizers, Yang et al. 2023) on an agent and a frozen Benchmark, or on the precise-summary demo task shipped with this Skill: propose instructions from the scored history, measure each one, keep the best.",
        "2026.11.05.1",
      ),
    ]),
    libraryPlugin(skilladamPkg, skilladamIcon, [
      skill(
        "skilladam-rsi-toolkit",
        "Run a SkillAdam experiment on the Project's selected Benchmarks: train once in a continuing Agent Session, freeze the learned Skill, then evaluate it repeatedly on held-out tasks.",
        "2026.10.29.4",
      ),
    ]),
    libraryPlugin(skilloptPkg, skilloptIcon, [
      skill(
        "skillopt-rsi-toolkit",
        "Run SkillOpt on selected Project Benchmarks by learning bounded Skill edits from trajectories, selecting candidates on fixed evaluation tasks, and testing frozen baseline and final States.",
        "2026.10.30.1",
      ),
    ]),
    libraryPlugin(tracePkg, traceIcon, [
      skill(
        "trace-rsi-toolkit",
        "Organize TRACE experiments on published Benchmarks, train a modular skill bank from Actor trajectories, select a checkpoint by training scores, and compare it with a no-Skill baseline on independent tests.",
        "2026.10.29.4",
      ),
    ]),
  ];
}

/** The Agent Evaluation plugin: the evaluator every toolkit measures through, and Benchmark design. */
export function agentEvaluationPlugin(): PluginItem {
  return libraryPlugin(evaluationPkg, evaluationIcon, [
    skill(
      "agent-evaluation",
      "Run one specified Test Agent on one specified Benchmark Case exactly once, privately score that execution, and return one protocol result.",
      "2026.11.03.1",
    ),
    skill(
      "benchmark-design",
      "Design and calibrate a multi-Case capability Benchmark and establish a traceable Formal Baseline, or import a published Benchmark package.",
      "2026.11.01.1",
    ),
  ]);
}
