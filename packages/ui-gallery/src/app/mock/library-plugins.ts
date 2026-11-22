/**
 * The library plugins of the demo, read from the packages the product ships
 * (`plugins/<name>/package.json` and `icon.svg`) and the cards they declare: the RSI toolkits,
 * which make up the library's `rsi` category, and the Agent Evaluation plugin they measure
 * through — the self-evolution story — and the rest of what the plugin market shows, in the
 * categories their cards name, plus two workbench plugins the market offers that this
 * repository does not ship yet (`marketPlugins().studios`). A card and its detail say what the
 * real plugin says, in both languages, and the start page counts the toolkits from this list as
 * the app counts them from the server's.
 *
 * Each card and each Skill's metadata is spelled here (the card as the plugin's src/index.ts
 * declares it; the Skill as its SKILL.md names, describes and versions it): the gallery does not
 * build the plugins' tables, and the SKILL.md bodies are too large to bundle into every frame for
 * one line each.
 */
import type { IconRef, PluginItem, SkillMetadataItem } from "@prismshadow/penguin-server/api";
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
import a2uiIcon from "../../../../../plugins/a2ui/icon.svg?raw";
import a2uiPkg from "../../../../../plugins/a2ui/package.json";
import browserIcon from "../../../../../plugins/browser-automation/icon.svg?raw";
import browserPkg from "../../../../../plugins/browser-automation/package.json";
import goalIcon from "../../../../../plugins/goal/icon.svg?raw";
import goalPkg from "../../../../../plugins/goal/package.json";
import bentoIcon from "../../../../../plugins/use-bento-slides/icon.svg?raw";
import bentoPkg from "../../../../../plugins/use-bento-slides/package.json";
import companyIcon from "../../../../../plugins/agent-company/icon.svg?raw";
import companyPkg from "../../../../../plugins/agent-company/package.json";
import supportIcon from "../../../../../plugins/penguin-support/icon.svg?raw";
import supportPkg from "../../../../../plugins/penguin-support/package.json";
import dataIcon from "../../../../../plugins/data-analysis/icon.svg?raw";
import dataPkg from "../../../../../plugins/data-analysis/package.json";
import firecrawlIcon from "../../../../../plugins/use-firecrawl/icon.svg?raw";
import firecrawlPkg from "../../../../../plugins/use-firecrawl/package.json";
import humanizerIcon from "../../../../../plugins/humanizer/icon.svg?raw";
import humanizerPkg from "../../../../../plugins/humanizer/package.json";
import softwareIcon from "../../../../../plugins/software-development/icon.svg?raw";
import softwarePkg from "../../../../../plugins/software-development/package.json";
import claudeCodeIcon from "../../../../../plugins/use-claude-code/icon.svg?raw";
import claudeCodePkg from "../../../../../plugins/use-claude-code/package.json";
import agentDevIcon from "../../../../../plugins/agent-development/icon.svg?raw";
import agentDevPkg from "../../../../../plugins/agent-development/package.json";

/** The npm fields of a plugin's package.json the library listing reads. */
interface Manifest {
  name: string;
  version: string;
  description: string;
  license?: string;
  author?: { name: string };
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
  a2ui: {
    title: "A2UI Interactive Answers",
    titleZh: "A2UI 交互式回答",
    descriptionZh:
      "让模型输出更易读的富文本组件：选项、表单、分步操作、提示框、Mermaid 图、由数据绘制的基础统计图（折线、面积、柱状、饼图、散点、直方图或仪表），以及基于这些统计图构建的一眼可读的小组件（天气卡片、用仪表展示额度余量、预算或任务进度的指标面板、系统资源面板），外加实时时钟与倒计时，以围栏代码块的形式写在普通 Markdown 回复里，Web App 用自己的组件渲染，其他界面显示为纯文本；用户的选择以普通文字填入输入框。附带中英文的 STE 风格写作规则、两个把天气查询和系统快照直接生成组件块的脚本，以及一个检查脚本：发送前校验每个组件、给草稿打分并打印自审清单。",
    shortDescription:
      "Choices, forms, steps, callouts, diagrams and widgets in replies, with a checker.",
    shortDescriptionZh: "在回复里使用选项、表单、步骤、提示框、图表和小组件，并自带检查脚本。",
    quickStart: {
      prompt:
        "Ask me which of three weekend plans I prefer as a choice block, then show the one I pick as a short procedure in steps.",
      promptZh:
        "用选项组件问我三个周末计划中更喜欢哪一个，再把我选中的那个写成一份简短的分步操作。",
      skills: ["a2ui"],
    },
  },
  "browser-automation": {
    title: "Browser Automation",
    titleZh: "浏览器自动化",
    descriptionZh:
      "用 penguin browser 在 shell 中驱动 Agent 浏览器——桌面应用的内置浏览器或用户自己的 Chrome，由用户选择——以简化 HTML 或纯文本读取页面，用 JavaScript 以及可信的点击与输入操作页面，提取订单、搜索结果等结构化数据；登录用的是用户自己的账号。",
    shortDescription: "Read pages, act and extract data in the built-in browser or your Chrome.",
    shortDescriptionZh: "在内置浏览器或你的 Chrome 中读取页面、执行操作、提取数据。",
    quickStart: {
      prompt:
        "Open news.ycombinator.com in the agent browser and list the top five stories as a table of title, points and link.",
      promptZh:
        "在 Agent 浏览器中打开 news.ycombinator.com，把排名前五的帖子整理成表格：标题、分数和链接。",
      skills: ["browser-automation"],
    },
  },
  goal: {
    title: "Goal Mode",
    titleZh: "目标模式",
    descriptionZh:
      "目标模式：一个 stop hook，让会话持续朝目标工作——每轮重新注入目标并检查目标文件——直到目标完成、受阻或 token 预算耗尽。",
    shortDescription: "Loop the session on an objective until it is done.",
    shortDescriptionZh: "让会话循环推进一个目标直到完成。",
    quickStart: {
      prompt:
        "Write fizzbuzz.py in this Workspace that prints FizzBuzz for 1 to 30, run it, and check that every line of the output is right.",
      promptZh:
        "在当前工作区写一个 fizzbuzz.py，打印 1 到 30 的 FizzBuzz，运行它，并逐行确认输出正确。",
      goal: true,
    },
  },
  "use-bento-slides": {
    title: "Bento Slides",
    titleZh: "Bento 幻灯片",
    shortDescription: "Author Bento slide decks.",
    shortDescriptionZh: "制作 Bento 幻灯片。",
    quickStart: {
      prompt:
        "Make a three-slide Bento deck in this Workspace introducing PenguinHarness: a title slide, what it does, and how to get started.",
      promptZh:
        "在当前工作区做一份三页的 Bento 幻灯片介绍 PenguinHarness：标题页、它能做什么、如何上手。",
      skills: ["bento-slides"],
    },
  },
  "agent-company": {
    title: "Agent Company",
    titleZh: "智能体公司",
    descriptionZh:
      "把 Project 里的 Agent 组织成一家公司：先与用户一问一答地创建组织，再是每个工位会话与工单会话都遵循的员工协议（触发块、工单看板、频道礼仪、预算、重负载或不可逆的事先向董事会请示），以及 CEO、人事与财务的操作手册——使命拆解为工单、招募与日程、预算与成本巡检——还有科研协议（在董事会批准的资源额度内跑 autoresearch 式实验循环、作者与审稿人对抗评审），以及让数字分身在真人之间传话的镜像协议。",
    shortDescription:
      "Company setup plus the employee, CEO, HR, finance, research and mirror playbooks.",
    shortDescriptionZh: "创建组织，以及员工、CEO、人事、财务、科研、镜像公司的操作手册。",
    quickStart: {
      prompt:
        "Create a company-mode organization for this Project: ask me for its id, name, mission, shared workspace, model and CEO budget one question at a time, confirm the whole thing with me, then create it.",
      promptZh:
        "为这个 Project 创建一个公司模式的组织：一次问我一个问题，收齐它的 id、名称、使命、共享工作区、模型和 CEO 预算，整体向我确认后再创建。",
      skills: ["company-setup"],
    },
  },
  "penguin-support": {
    title: "PenguinHarness Q&A Assistant",
    titleZh: "PenguinHarness 问答助手",
    descriptionZh: "PenguinHarness 产品客服：问题列表、对话弹窗，以及依据文档和源码的解答。",
    shortDescription: "Product questions, sourced answers and a support workbench.",
    shortDescriptionZh: "产品问答、来源引用与客服工作台。",
    quickStart: {
      prompt:
        "How do I create an agent and choose its model in PenguinHarness? Cite the official docs.",
      promptZh: "如何在 PenguinHarness 中新建智能体并选择模型？请引用官方文档。",
      skills: ["penguin-support"],
    },
  },
  "data-analysis": {
    title: "Data Analysis",
    titleZh: "数据分析",
    shortDescription: "Deliver correct data-analysis artifacts with bounded verification.",
    shortDescriptionZh: "以正确数据语义完成产物并进行有界核查。",
    quickStart: {
      prompt:
        "Create a CSV of 30 days of made-up daily sales in this Workspace, then analyze it: weekly totals, the best and the worst day, and a line chart saved as sales.png.",
      promptZh:
        "在当前工作区生成一份 30 天的虚构日销售额 CSV，然后分析它：每周合计、最好和最差的一天，并把折线图保存为 sales.png。",
      skills: ["data-analysis"],
    },
  },
  "use-firecrawl": {
    title: "Firecrawl Search",
    titleZh: "Firecrawl 搜索",
    shortDescription: "Web search and page scraping via Firecrawl.",
    shortDescriptionZh: "用 Firecrawl 做网络搜索与页面抓取。",
    quickStart: {
      prompt:
        "Search the web for the latest PenguinHarness release and summarize its three most important changes, with links to the sources.",
      promptZh: "在网上搜索 PenguinHarness 的最新版本，概括其中最重要的三项改动，并附上来源链接。",
      skills: ["firecrawl"],
    },
  },
  humanizer: {
    title: "Humanizer",
    titleZh: "去 AI 味写作",
    shortDescription: "Strip AI-writing tells from prose in any language.",
    shortDescriptionZh: "去除文本的 AI 味，把行文改成书籍、报纸、百科式的风格，任何语言通用。",
    quickStart: {
      prompt:
        'Rewrite this so it reads like edited human writing: "In today\'s fast-paced world, it is important to note that leveraging cutting-edge solutions can unlock a myriad of opportunities and drive meaningful impact across diverse domains."',
      promptZh:
        "把这段话改写成像经过编辑的人写的文字：「在当今快速发展的时代，值得注意的是，借助前沿解决方案能够解锁无数机遇，并在多元领域推动有意义的影响。」",
      skills: ["humanizer"],
    },
  },
  "software-development": {
    title: "Software Development",
    titleZh: "软件开发",
    descriptionZh:
      "端到端的软件开发——面向真实任务的软件工程实践准则，加上生成网页与应用界面的 Penguin 视觉规范。",
    shortDescription: "Engineering practice and web UI defaults in one plugin.",
    shortDescriptionZh: "软件工程实践与网页视觉规范合一。",
    quickStart: {
      prompt:
        "Build a single-file landing page, index.html, in this Workspace for a made-up note-taking app, with a light and a dark theme.",
      promptZh:
        "在当前工作区为一个虚构的笔记应用做一个单文件落地页 index.html，带浅色和深色两套主题。",
      skills: ["web-design"],
    },
  },
  "use-claude-code": {
    title: "Remote Claude Code",
    titleZh: "远程操控 Claude Code",
    shortDescription: "Run Claude Code on remote hosts over SSH.",
    shortDescriptionZh:
      "在远程主机上通过 SSH 运行 Claude Code（持久会话 / headless / tmux 交互 / 多轮续接）。",
    quickStart: {
      prompt:
        "Check whether ssh and the claude CLI are available on this machine, then show the exact commands you would use to run a headless Claude Code task on a remote host.",
      promptZh:
        "检查这台机器上 ssh 和 claude CLI 是否可用，然后给出在远程主机上以无界面方式运行一次 Claude Code 任务的具体命令。",
      skills: ["remote-claude-code"],
    },
  },
  "agent-development": {
    title: "Agent Development",
    titleZh: "智能体开发",
    descriptionZh:
      "基于 PenguinHarness 的智能体开发：依据需求初始化智能体、用 SDK 构建应用或经 Agent API 接入智能体、搭建 Workbench（智能体自己维护的、对话旁的页面）、经统一的 LLM API 调用任意模型、管理模型与密钥、编排智能体/会话/成本/定时任务。",
    shortDescription:
      "Agent setup, SDK, Agent API, workbenches, LLM API, config and orchestration.",
    shortDescriptionZh: "智能体初始化、SDK、Agent API、Workbench、LLM API、配置与编排。",
    quickStart: {
      prompt:
        "Use the penguin CLI to list the agents in this Project and the five most recent sessions, then tell me in one line each what every agent is for.",
      promptZh:
        "用 penguin CLI 列出当前 Project 里的 Agent 和最近五个会话，再用一句话说明每个 Agent 是做什么的。",
      skills: ["penguin-orchestration"],
    },
  },
};

/**
 * A shipped icon as a listing names it. The server names a route serving the file; the gallery
 * has no server, so the file's own text is the image, as a data URL. Every shipped icon is
 * monochrome line art in currentColor, which the server marks to take the text colour.
 */
export function shippedIcon(svg: string): IconRef {
  return { url: `data:image/svg+xml,${encodeURIComponent(svg.trim())}`, tint: true };
}

/** What a plugin ships besides Skills: its hook package's points and version, its workbenches. */
type Extras = Partial<Pick<PluginItem, "hooks" | "hookVersion" | "workbenches">>;

/** A library plugin as GET /api/plugins lists one this build ships. */
function libraryPlugin(
  manifest: Manifest,
  svg: string,
  skills: SkillMetadataItem[],
  extras: Extras = {},
): PluginItem {
  const name = manifest.name.replace(/^@[^/]+\//, "");
  return {
    name,
    ...CARDS[name],
    description: manifest.description,
    version: manifest.version,
    package: manifest.name,
    source: "builtin",
    ...(manifest.author ? { author: manifest.author.name } : {}),
    ...(manifest.license ? { license: manifest.license } : {}),
    repository: "https://github.com/Prism-Shadow/penguin-harness",
    skills,
    hooks: [],
    icon: shippedIcon(svg),
    mcpServers: [],
    ...extras,
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

/** The PenguinHarness Q&A Assistant: a Skill, and the `support` workbench it installs. */
export function penguinSupportPlugin(): PluginItem {
  return libraryPlugin(
    supportPkg,
    supportIcon,
    [
      skill(
        "penguin-support",
        "Answer PenguinHarness product questions and troubleshoot setup, models, agents, plugins and workbenches using the official documentation and source code.",
        "2026.10.14.2",
      ),
    ],
    { workbenches: [{ name: "support", version: "2026.11.04.1" }] },
  );
}

/** The goal-mode plugin: a hook package and no Skills. */
export function goalPlugin(): PluginItem {
  return libraryPlugin(goalPkg, goalIcon, [], {
    hooks: ["user_prompt", "stop"],
    hookVersion: "2026.10.26.1",
  });
}

/**
 * A workbench plugin the market offers that this repository does not ship yet: installed on the
 * server by an admin, one workbench, no icon (its cover is the generated one).
 */
function studioPlugin(fields: {
  name: string;
  title: string;
  titleZh: string;
  description: string;
  descriptionZh: string;
  shortDescription: string;
  shortDescriptionZh: string;
}): PluginItem {
  return {
    ...fields,
    version: "0.1.0",
    package: `@penguinharness/${fields.name}`,
    source: "installed",
    author: "Prism-Shadow",
    license: "Apache-2.0",
    skills: [],
    hooks: [],
    workbenches: [{ name: "studio", version: "2026.11.14.1" }],
    mcpServers: [],
  };
}

/**
 * The rest of the library the market shows, by the category each plugin's card declares:
 * office productivity (the goal and support plugins are their own builders above, since other
 * fixtures name them), software development and AI app development; and the two demo workbench
 * plugins, in office productivity, that feed the App Center's "Add apps" section.
 */
export function marketPlugins(): {
  office: PluginItem[];
  software: PluginItem[];
  aiApp: PluginItem[];
  studios: PluginItem[];
} {
  return {
    office: [
      libraryPlugin(a2uiPkg, a2uiIcon, [
        skill(
          "a2ui",
          "Make a reply easier to read and act on with rich blocks inside ordinary Markdown: a choice, a form, a procedure in steps, a callout, a Mermaid diagram, widgets and charts drawn from data.",
          "2026.11.04.1",
        ),
      ]),
      libraryPlugin(browserPkg, browserIcon, [
        skill(
          "browser-automation",
          "Drive the PenguinHarness agent browser from the shell with `penguin browser`: open pages, read them as simplified HTML or text, act with JavaScript and trusted clicks and typing, and pull structured data out of them.",
          "2026.10.22.1",
        ),
      ]),
      libraryPlugin(bentoPkg, bentoIcon, [
        skill(
          "bento-slides",
          "Create and edit Bento presentations — self-contained .bento.html decks whose document is JSON.",
          "2026.10.11.1",
        ),
      ]),
      libraryPlugin(companyPkg, companyIcon, [
        skill(
          "company-ceo",
          "Run a PenguinHarness organization as its CEO — turn the mission into a ticket tree, hire HR and finance first, schedule the calendar and report to the board.",
          "2026.11.03.1",
        ),
        skill(
          "company-employee",
          "The protocol every employee of a PenguinHarness organization follows: the handbook, work runs, tickets, channels and budget discipline.",
          "2026.11.05.1",
        ),
        skill(
          "company-finance",
          "Run finance for a PenguinHarness organization — set and adjust monthly budgets, audit spend daily and explain budget alerts.",
          "2026.10.10.1",
        ),
        skill(
          "company-hr",
          "Run HR for a PenguinHarness organization — calendars, hiring and offboarding, evaluating and improving employees.",
          "2026.10.12.1",
        ),
        skill(
          "company-mirror",
          "Run a PenguinHarness organization that mirrors a real company — one digital twin per real colleague.",
          "2026.10.10.1",
        ),
        skill(
          "company-research",
          "Run experiments and papers in a PenguinHarness research organization, with adversarial review of every claim.",
          "2026.10.10.1",
        ),
        skill(
          "company-setup",
          "Create a company-mode organization together with the user, one question at a time.",
          "2026.10.10.1",
        ),
      ]),
      libraryPlugin(dataPkg, dataIcon, [
        skill(
          "data-analysis",
          "Complete data-analysis tasks with bounded inspection, correct data semantics, native artifact handling, complete delivery, and risk-based verification.",
          "2026.10.04.1",
        ),
      ]),
      libraryPlugin(firecrawlPkg, firecrawlIcon, [
        skill(
          "firecrawl",
          "Search the web and scrape pages into clean markdown with the Firecrawl API.",
          "2026.10.04.1",
        ),
      ]),
      libraryPlugin(humanizerPkg, humanizerIcon, [
        skill(
          "humanizer",
          "Rewrite or edit prose in any language so it reads like edited human writing in the register of books, newspapers and encyclopedias rather than default AI output.",
          "2026.10.04.1",
        ),
      ]),
    ],
    software: [
      libraryPlugin(softwarePkg, softwareIcon, [
        skill(
          "software-engineering",
          "Complete software-engineering tasks — investigate and review code, implement bug fixes, features and refactors with minimal scope, validate changes, and report verified outcomes.",
          "2026.10.04.1",
        ),
        skill(
          "web-design",
          "Penguin visual language for generated web pages and app UIs — GitHub-style simplicity with a single blue accent, light and pure-black dark themes.",
          "2026.11.04.1",
        ),
      ]),
      libraryPlugin(claudeCodePkg, claudeCodeIcon, [
        skill(
          "remote-claude-code",
          "Run Claude Code on a remote host over SSH — a persistent login session, headless runs, the interactive TUI inside a remote tmux, and multi-turn continuity.",
          "2026.10.04.1",
        ),
      ]),
    ],
    aiApp: [
      libraryPlugin(agentDevPkg, agentDevIcon, [
        skill(
          "agent-initialization",
          "Initialize or extend an Agent from a user requirement - write AGENTS.md, set identity metadata, and create, install or import Skills and hook packages.",
          "2026.11.07.1",
        ),
        skill(
          "penguin-config",
          "Manage model API keys, default models and per-agent vault secrets with the penguin CLI.",
          "2026.11.02.1",
        ),
        skill(
          "penguin-orchestration",
          "Drive PenguinHarness itself from a shell — list and create agents and sessions, send and steer messages mid-flight, and query costs and scheduled tasks.",
          "2026.10.15.1",
        ),
        skill(
          "penguin-plugin",
          "Use for workbenches — the tabs and pages beside the chat, with server code behind them, that an Agent keeps in the `workbenches/` folder of its Agent State.",
          "2026.11.09.1",
        ),
        skill(
          "penguin-sdk",
          "Use to build a standalone external program with an agent in it, or connect an external program to a Penguin agent.",
          "2026.10.26.1",
        ),
        skill(
          "unified-llm-api",
          "Call model APIs through @prismshadow/mmsp (MMSP) — streaming text generation, image generation, speech synthesis, embeddings and the supported-model registry with one client.",
          "2026.10.24.1",
        ),
      ]),
    ],
    studios: [
      studioPlugin({
        name: "bento-studio",
        title: "AI PPT Workbench",
        titleZh: "AI PPT 工作台",
        description:
          "A workbench beside the chat for drafting, editing and presenting slide decks with the agent.",
        descriptionZh: "对话旁的工作台：和智能体一起起草、编辑并放映幻灯片。",
        shortDescription: "Draft, edit and present slide decks beside the chat.",
        shortDescriptionZh: "在对话旁起草、编辑并放映幻灯片。",
      }),
      studioPlugin({
        name: "perler-studio",
        title: "Perler Bead Studio",
        titleZh: "拼豆工作台",
        description:
          "A workbench that turns a picture into a perler bead pattern, with the bead count for each colour.",
        descriptionZh: "把一张图片转换成拼豆图纸，并按颜色统计所需豆子数量的工作台。",
        shortDescription: "Turn a picture into a bead pattern with counts per colour.",
        shortDescriptionZh: "把图片转换成拼豆图纸，并按颜色统计豆子。",
      }),
    ],
  };
}
