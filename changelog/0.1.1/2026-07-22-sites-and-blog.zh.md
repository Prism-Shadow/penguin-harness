# 站点：统一导航栏、更丰富的博客，以及列出内置 Skill

- **Date:** 2026-07-22
- **Type:** process
- **Scope:** `landing`, `docs`
- **PR:** [#20](https://github.com/Prism-Shadow/penguin-harness/pull/20), [#23](https://github.com/Prism-Shadow/penguin-harness/pull/23), [#25](https://github.com/Prism-Shadow/penguin-harness/pull/25), [#32](https://github.com/Prism-Shadow/penguin-harness/pull/32), [#42](https://github.com/Prism-Shadow/penguin-harness/pull/42), [#45](https://github.com/Prism-Shadow/penguin-harness/pull/45)

[English](2026-07-22-sites-and-blog.md)

## 文档站与落地页的导航栏完全一致

两个站点的导航栏此前在容器宽度（6xl 对 7xl）、仅文档站才有的徽章药丸、汉堡菜单位置，以及一个失效的菜单动画类上存在差异。现在两者共用同一个 `max-w-7xl` 容器（落地页页脚也对齐到同一宽度，使导航与页脚框定一致，而内容小节仍为 6xl）、同一个 logo 区块，以及同样的右侧集群布局；落地页语言菜单中未定义的 `anim-pop` 类被替换为可用的 `anim-fade`。跨 SPA 的链接语义与各站点的移动端行为保持原样。

## 博客分类、置顶文章与页面元信息

博客列表仍是一个扁平列表，带分类徽章与筛选药丸，现在覆盖四个分类——产品动态、发布说明、技术实践（AMD 本地 Agent 那篇已移入此类）与观点。观点类收录分析与看法，而非动手教程，把实践类留给可以跟着做的文章；它标为 "Perspectives" / 「观点」，配青色徽章，与品牌蓝的产品类、实践类徽章以及中性色的发布说明徽章区分开。文章可通过 frontmatter 中的 `pinned: true` 置顶；介绍 PenguinHarness 的发布文章已置顶。博客新增第二篇实践文章：在 AMD GPU 上用 PenguinHarness 实现 Agent 自我改进（中英），并纳入同一套分类与作者约定。详情页把元信息移到标题下方：按语言格式化的日期（"July 20, 2026" / 「2026年7月20日」）、作者行（取自 frontmatter 的 `author`，默认为 Yaowei Zheng (PrismShadow AI)），以及一个复制页面链接的按钮，带安全的剪贴板回退与短暂的「已复制」状态。

## 三篇关于 Harness 设计与 Agent 基础设施的技术文章

博客在新的观点分类下新增三篇双语文章，每篇都以一手材料而非二手摘要为依据：

- **Simple Harness Is All You Need**——以 Databricks 编码 Agent 基准测试中那个反直觉的结果开篇：在他们的成本对通过率帕累托图上（经授权转载为 `blog-assets/databricks-pareto.png`），全场最高分属于跑在极简 Pi Harness 上的 Opus 4.8，领先于同一模型在最大努力档下的 Claude Code，而每任务成本约为其一半，且前沿区大部分由 Pi 占据。文章保留了 Databricks 自己的告诫——Pi 在 `max` 努力档下的表现明显低于同等花费的 Claude Code——以及他们给出的解释：Pi 每轮发送的上下文约为其三分之一。随后文章把这一点映射到 PenguinHarness 可量化的设计上：六个内置工具且完全没有文件工具、72 行的系统提示词、16,000 字符的输出上限，以及压缩进全新上下文——再论证极简主义必须止步于何处，因为 Pi 完全不提供权限系统，而逐次调用审批与 Trace 审计在这里是承重结构。
- **The Easiest Way to Build AI Agents in 2026**——论证构建 Agent 的成本已经从 Agent 本身转移到围绕它组装的技术栈上：在最流行的方案里，这意味着用 LangChain 构建、LangGraph 编排、LangSmith 或 Langfuse 观测与评估、LangGraph Platform 部署——横跨两三家厂商的五个产品，各有各的概念与文档，外加一个人肉充当优化循环。文章按 2026-07-22 核实的事实，把五个代表性方案与 PenguinHarness 做了对比，指出该领域正在向「薄」收敛（AutoGen 进入维护模式、LangChain 的遗留接口迁入 `langchain-classic`、"harness" 一词在两个月内被 AWS、Microsoft 与 Anthropic 采纳为厂商术语），并与之对照地给出一次安装即同时具备聊天、Skill、模型、用量、Trace 与评估中心，然后把调优循环交给 Agent 自己。文中包含一节「什么时候不该用 PenguinHarness」。
- **AI Infrastructure: Past, Present, and Future**——论证 AI 开发栈（PyTorch、vLLM、Ollama、LlamaFactory）是为人类操作者设计的：这个人把状态记在脑子里、把报错当作调查的起点、文档只读一遍。它并不需要为 Agent 重新发明，因为它本就是命令与配置文件；真正缺失的是围绕它的操作性知识，而已发布的 `ollama`、`vllm` 与 `llamafactory` 三个 Skill 正是把这些编码下来——改动之前先检查、对真正起约束作用的那个条件做预检、用一次观测来验证、把部署好的模型注册上去，好让这件事是完成而不是开了个头。文章以尚未解决的问题收尾：ML 栈的报错仍然是写给人看的、GPU 作为共享资源却没有预约协议，以及可复现性。

落地页博客列表的测试同步更新为新的文章数量，以及由此产生的实践分类排序。

## 内置 Skill，列在人们会去看的地方

README（两种语言）新增一个紧凑的「内置 Skill」小节——一张表列出四个 Skill 分组及其成员——落地页也在 Features 与 Security 之间新增一个对应的 Skills 小节，以分组卡片呈现。这些列表覆盖当前已发布的内容，并随新 Skill 落地而增长——本次发布中已刷新，把 vLLM/Ollama 部署与 LlamaFactory 微调 Skill 纳入其中。
