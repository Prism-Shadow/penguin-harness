# README、博客与文档站

- **Date:** 2026-07-20
- **Type:** process
- **Scope:** `docs`, `landing`
- **PR:** [#7](https://github.com/Prism-Shadow/penguin-harness/pull/7)

[English](2026-07-20-readme-blog-and-docs.md)

## README

仓库的 README（中英）。

### 围绕产品叙事重构 README

README 现在以「Agent 构建 Agent」的主张与社区链接开场，随后是三块功能展示（基准测试图表、一句话 RAG 演示、自进化），再依次是 changelog / 博客 / 文档、支持的模型、以人为先的安装说明、路线图、CONTRIBUTING、引用格式与致谢。

### 细节

- 新的叙事标题："With LangChain, you build agents by hand — at 1x speed. With PenguinHarness, agents build agents — at 100x."，副标题为 "A zero-code CLI and Web UI, connected to 1000+ models"，另附社区链接（Discord / X / 微信）。
- 功能一「简单高效」：由落地页基准数据生成的明暗两版柱状图（相对 Claude Code 与 OpenAI Codex 的准确率与单次运行成本，三者均由 DeepSeek V4 Pro 驱动），以 `assets/readme/benchmark-{light,dark}.svg` 提交。
- 功能二「一句话构建 Agent」：一句话 RAG 提示词，配上由新增的 `packages/landing/scripts/capture-readme-demo.mjs` 拍摄的真实产品截图（与落地页截图相同的真实服务端 + mock LLM 流水线），以 `assets/readme/rag-demo-{light,dark}.webp` 提交。
- 功能三「自进化」：描述「评估—优化—快照」循环的文案，并留有一个 HTML 注释占位符，用于后续的演示视频。
- 新增小节：Changelog / 博客 / 文档链接，一张支持模型表（DeepSeek V4、Kimi K3、GLM 5.2、Hunyuan 3、Qwen 3.8 Max、GPT 5.5、Gemini 3.5 Flash、Claude Opus 4.8 及其 Provider，另附「经网关可达 1000+」的说明），Requirements 与 Installation 拆分为「Web App —— 面向人」与「CLI & SDK —— 面向 Agent」，一份路线图（基准测试套件发布），一段 BibTeX 引用（{PrismShadow Team}），以及许可证与致谢页脚。
- 新增的 `CONTRIBUTING.md` 吸收了面向开发者的内容：开发命令、仓库结构表、质量门禁、英文化与 changelog 的工作规则，以及 README 素材的再生成说明；README 的 Development 小节现指向该文件。
- `README.zh.md` 以中文镜像同一结构。

### 按当前目录刷新 README 模型表

支持模型表（同样是这八个模型）改为两列——左侧为模型，右侧为逗号分隔的、可提供该模型的 Provider 列表（依当日目录）——下方的说明现在列出全部五个 OpenAI 兼容网关。

### 细节

- 依目录的可得性：DeepSeek V4 见于五个分组，GLM 5.2 见于六个，Kimi K3 经 OpenRouter 与 Qwen 按量付费提供，Qwen 3.8 Max 为 Token Plan 预览版，GPT 5.5 与 Claude Opus 4.8 为原厂直连 + OpenRouter，Hunyuan 3 经 OpenRouter 提供，Gemini 3.5 Flash 为原厂直连。
- 网关说明列出 OpenRouter、Fireworks AI、SiliconFlow、Qwen Token Plan 与 Qwen Pay-As-You-Go。README.zh.md 同步镜像。

### 徽章分行，并展示成品 RAG 应用

站点徽章（Website / Docs / Blog）与社区徽章（Discord / X / 微信）现在分列两行。一句话示例改为精简版的 claude-code-docs 配置专家提示词（聊天页的示例任务承载完整版），演示图片改为展示**成品**——生成出的 docs-expert 应用，带可点击的引用来源与示例问题（`assets/readme/rag-app-<lang>-<theme>.webp`，按语言各拍一版；中文 README 展示中文提示词与中文截图）——而不再是 PenguinHarness 的聊天界面。效果图渲染器（`rag-app-mockup.html` 加上重写的 `capture-readme-demo.mjs`，无需启动服务端）一并提交，以保证素材可再生。

## 博客与文档站

博客文章与文档站。

### 公告栏、AMD Fireworks 额度博文，以及 GDPevo 发布故事

站点新增一个轮播公告栏、一篇新的活动文章，以及一篇终于把来龙去脉讲全的发布文章。

- **公告栏**——位于导航之上的可切换栏（每 6 秒自动轮播，悬停暂停，带前后箭头）：第一条宣布 Kimi K3 与 Qwen 3.8 Max 上线（链接到模型文档），第二条为 $50 Fireworks 额度活动（链接到新文章）。中英双语，出现在每个页面上，随页面滚动移出。
- **新博文 `fireworks-credits-amd`（中英）**——宣布与 AMD AI Developer Program 的合作，提供免费的 Fireworks 兑换码：先是逐步的申请流程（加入 ADP、进入 Member Perks、在表单中选择 Fireworks AI、审核、收到优惠券邮件、兑换并获取 API key，截图改编自 WhatGhost 的指南并注明出处），随后是三步 PenguinHarness 配置（安装、Fireworks 分组统一填 key + 预设 + 测速、运行）。
- **发布文章重写（中英）**——现以 GDPevo 的起源故事开篇：自进化已在团队的 GDPevo Benchmark（附链接）中得到验证，而把它带给所有人正是 PenguinHarness 存在的理由。其余部分与 README 呼应：三条编号理由，配基准图表与 RAG 演示图（由站点自己的 /blog-assets/ 提供），安全约定，带「任意 OpenAI 协议均可」说明的模型表，安装与使用步骤，路线图（基准测试套件、桌面应用、Windows），以及结尾的社区召唤（Discord / X / 微信 / GitHub）。

### 发布文章定稿为编号的三条理由结构

发布博文（中英）保留 GDPevo 起源故事与编号式的「Why PenguinHarness」结构——### 1 复杂任务上更强且成本更低（基准图表 + 表格）、### 2 一句话让 Agent 构建你的应用（提示词 + 演示图）、### 3 自进化——其后依次是安全约定、模型表、仅面向 Web 的「如何使用」（安装 + penguin web + 模型页；不含 CLI 命令）、路线图与社区召唤。

### 发布文章改用精简提示词展示成品 RAG 应用

一句话构建那一节现在使用精简版的 claude-code-docs 配置专家提示词（中文版文章中为中文），并配上生成出的 docs-expert 应用的成品截图（按语言各一版，由 /blog-assets/ 提供），取代原先 PenguinHarness 的聊天界面截图。
