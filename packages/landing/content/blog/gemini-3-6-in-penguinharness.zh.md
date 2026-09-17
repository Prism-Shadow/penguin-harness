---
title: PenguinHarness 0.1.1：支持 Gemini 3.6 Flash 与 3.5 Flash-Lite
date: 2026-07-22
category: news
excerpt: 按 Google 公布的数据，Gemini 3.6 Flash 在 MLE-Bench 上得分 63.9%，3.5 Flash 为 49.7%，价格却更低。PenguinHarness 0.1.1 已把它和 3.5 Flash-Lite 加入模型目录。本文讲清它为什么重要，以及这个版本的其余更新。
---

Google 发布 Gemini 3.6 Flash 和 3.5 Flash-Lite 的第二天，PenguinHarness 0.1.1 就把它们加入了模型目录。按 Google 的数据，3.6 Flash 的 MLE-Bench 成绩是 63.9%，3.5 Flash 是 49.7%，而且价格更低。这个版本还把最大输出长度改成按模型设置，修正了 Gemini 的缓存价格，并新增 `penguin update` 命令用于原地升级。

## Gemini 3.6 Flash 为什么对 PenguinHarness 重要

Google 在 2026 年 7 月 21 日发布了 [Gemini 3.6 Flash、3.5 Flash-Lite 与 3.5 Flash Cyber](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/)。对 PenguinHarness 来说，这次发布里最重要的是一个数字：**MLE-Bench 63.9%，而 3.5 Flash 是 49.7%**。

MLE-Bench 衡量的是机器学习的工程能力：Agent 亲手构建、训练、调优一套 ML 系统，而不是回答关于它的问题。Google 自己的说法是，这体现了「ML Research 上的显著提升，见 MLE Bench（63.9% vs. 49.7%）」。这是 14.2 个百分点的提升，在下面那张图的三项百分制基准里幅度最大，也明显高于同一张图给出的上一代 Pro 级模型 3.1 Pro 的 42.6%。

PenguinHarness 存在的意义，就是让 Agent 构建 Agent，更快、更好、更便宜。这个产品跑的每一个循环，本质上都是一次小型的机器学习工程：把模型部署起来，交给 Agent 一个任务，用私有 Rubric 打分，读失败原因，调优，重新部署，再测一次。一个恰好在这件事上明显更强、又落在 Flash 价格档的模型，就是迄今最适合这套 Harness 日常工作的模型。

下文的每个数字都有同一个前提：它们都是 **Google 自己的数据，按 Google 自己的评测方法得出**，我们没有独立复现过其中任何一项。

## 其余的成绩单

![Gemini 3.6 Flash 评测图：DeepSWE v1.1、MLE-Bench、GDPval-AA v2 与 OSWorld-Verified 四项，逐项对比 Gemini 3.1 Pro、3.5 Flash 与 3.6 Flash](/blog-assets/gemini-3-6-flash-evals.webp)

图表出自 Google，转载自 Google 的发布博客 [Introducing Gemini 3.6 Flash, 3.5 Flash-Lite, and 3.5 Flash Cyber](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/)（2026 年 7 月 21 日）。图中全部数据与评测方法均出自 Google，而非我们自测。

MLE-Bench 不是孤证。对比 3.5 Flash，Google 给出的数据是：

| 基准             | 衡量的能力   | 3.5 Flash | 3.6 Flash |
| ---------------- | ------------ | --------: | --------: |
| MLE-Bench        | 机器学习工程 |     49.7% |     63.9% |
| DeepSWE v1.1     | 长程软件工程 |       37% |       49% |
| GDPval-AA v2     | 知识工作     |      1349 |      1421 |
| OSWorld-Verified | 计算机操作   |     78.4% |     83.0% |

另外三行恰好是机器学习工程循环所依赖的能力。长程软件工程能力决定了 Agent 修改训练配置、数据集脚本和部署参数时会不会反复折腾。Google 把 DeepSWE 的提升归因于「更高的精确度、更少的多余代码改动和更少的执行循环」。计算机操作现在是 Gemini API 与 Gemini Enterprise 中的内置客户端工具。

模型还带上了增强的 Frontier Safety 防护，针对 CBRN 与网络攻击类滥用。Google 表示，这让它「明显更难被越狱」，同时尽量减少对正当用途的拒答。

## 更少 Token、更少步数、更低单价

Google 对这次发布的定位，恰好就是这类 Harness 每天在做的事：「构建生产级 AI Agent 的开发者与客户，需要更高的 Token 效率、更低的延迟和更可靠的表现。」Agent 循环不是一次长补全，而是几十次短往返，每一次都带着工具 Schema、不断增长的对话记录和一份推理预算，每一步的效率决定了成本。

按 Google 的说法，在 Artificial Analysis Index 上，3.6 Flash 比 3.5 Flash **少消耗 17% 的输出 Token**，在 Datacurve 的 DeepSWE 等部分基准上观察到「最高 65%」。它还「完成多步工作流所需的推理步数与工具调用更少」。

这种效率提升「同时还配上了低于 3.5 Flash 的价格」：**输入 $1.50 / 百万 Token，输出 $7.50 / 百万 Token**。用 Google 的话说，这套组合「降低了每个 Agent 任务的总体成本，让 Agent 的构建与运行更划算」。自我进化循环每一轮都要重跑一整套 Benchmark，更少的 Token、更少的步数和更低的单价会叠加起作用。

## PenguinHarness 现已支持的模型

发布一天之后，目录里已经收录了这两个公开可用的模型，各有两条接入路径：

| 供应商分组    | 模型 ID                        |    上下文 | 视觉 |
| ------------- | ------------------------------ | --------: | ---- |
| Google Gemini | `gemini-3.6-flash`             | 1,048,576 | 支持 |
| Google Gemini | `gemini-3.5-flash-lite`        | 1,048,576 | 支持 |
| OpenRouter    | `google/gemini-3.6-flash`      | 1,048,576 | 支持 |
| OpenRouter    | `google/gemini-3.5-flash-lite` | 1,048,576 | 支持 |

Google 直连的两行按模型 ID 自动路由，只需要一个 `GEMINI_API_KEY`。OpenRouter 的两行已经内联了 OpenAI 客户端类型和网关的 base URL，只需要一个 OpenRouter API key。

无论走哪条路径，最快的方式都是 Web App 的**模型仓库**页面：找到那一行，填入 API key 即可。命令行也只要一条命令：

```bash
penguin config model add --provider google --model-id gemini-3.6-flash --api-key <your-key>
penguin config model list
```

随新模型一起落地的还有两处修正：

- Gemini 的价格现在按厂商真实的缓存命中价记录，不再把输入价重复填进缓存价：3.6 Flash 每百万缓存输入 Token $0.15，3.5 Flash-Lite $0.03。**成本中心**因此不再把缓存密集型开销高估一个数量级。
- `google/gemini-3.5-flash` 的上下文窗口此前记为 1,000,000，网关与直连端点的真实值都是 1,048,576。

### 3.5 Flash-Lite：负责扇出

第二个新模型的目标是吞吐，而不是深度。按 Artificial Analysis 的测量，Gemini 3.5 Flash-Lite 是 3.5 系列中最快的模型，达到 **350 输出 Token/秒**。定价为**输入 $0.30 / 百万 Token，输出 $2.50 / 百万 Token**。

Google 把它定位在 Agent 检索、文档处理这类高吞吐场景。它的思考等级可以配置，同一个模型既能调低，便宜地跑批量任务，也能调高，承担多步的子 Agent 负载。计算机操作在这里同样是内置工具。

与上一代 Flash-Lite 相比，Google 给出的数据是：Terminal-Bench 2.1 **54% 对 31%**，长上下文 GDM-MRCR v2 **72.2% 对 60.1%**，GDPval-AA v2 **1140 对 642**。在若干 Agent 与编码评测上，它甚至超过了 3 Flash：SWE-Bench Pro **54.2% 对 49.6%**，OSWorld-Verified **74.0% 对 65.1%**。

这很契合 PenguinHarness 所依赖的子 Agent 模式：能力更强的父模型负责规划，便宜且快的模型负责扇出执行。Google 自己的博客展示的也是这种形态：3.5 Flash-Lite「与担任主控 Agent 的 3.6 Flash 协同」，批量生成设计方案。

发布中的第三个模型 3.5 Flash Cyber 刻意不对外开放。Google 表示，它将仅通过 CodeMender、以限量试点计划的形式提供给政府与可信合作伙伴，所以 PenguinHarness 的目录里没有它。

## 0.1.1 的其余更新

Gemini 这几行只是一次更大规模目录刷新的一部分，而目录也只是这个版本改动的诸多方面之一。

### 模型与内核

SDK 升级到 **AgentHub 0.4.1**，这是一次类型兼容的升级。它新增的受支持模型注册表列出模型、base URL 与 client 三元组，附带模态、上下文窗口和每百万 Token 价格，成了这次目录刷新的权威来源。所有上下文窗口、视觉标记与价格都取自注册表，而不是厂商的宣传页。目录条目从 57 条增加到 70 条，新增的条目有：

- Gemini 3.6 Flash 与 3.5 Flash-Lite，覆盖上文的两条路径
- Anthropic 的 Claude Fable 5 与 Claude Sonnet 5
- Moonshot 的 Kimi K3
- OpenRouter 的 Kimi K2.6、Qwen3.6 35B A3B 与 GLM 5.1
- SiliconFlow 上的同样三个

SiliconFlow 的三行刻意不带价格：没有任何来源公布它们的费率，而猜一个数字比留空更糟。

如果你把 Agent 跑在本地或严格的端点上，有三处修复与你直接相关：

- **空工具列表不再发出。** 严格的 OpenAI 兼容服务会直接拒绝 `tools: []`，vLLM 会返回 `400 … tools must not be an empty array`。Harness 所有不带工具的请求此前都会撞上它：连通性探测、会话标题生成和视觉描述。现在列表为空时，整个字段直接省略。
- **最大输出长度改为按模型设置。** 本地部署的 32k 上下文模型会直接拒绝请求，因为 Agent 级默认值要求 32,000 个输出 Token。**模型仓库**页面和 `penguin config model add --max-tokens` 现在支持按模型设置上限，优先级高于 Agent 默认值。带外请求取两者中较小的一个。
- **默认系统提示词加了护栏。** Agent 为了腾出被占用的端口而杀掉监听进程时，有时杀掉的是 Harness 自己的服务。提示词现在要求：绝不杀死不是自己启动的进程，端口被占就另选一个空闲端口。遇到 401、403 或无效 key 错误时，Agent 只重试一次，随后停下，请你在对话之外更新 key，因为密钥不该出现在聊天记录里。已有 Agent 保留当前的提示词，新建的 Agent 才带上这些规则。

还有两项运行时设置换了形态：

- **思考等级**从**模型仓库**页面挪到了对话草稿区模型选择器旁的紧凑选择器（`low` / `medium` / `high` / `xhigh`），并写回 Agent 设置，发送时创建的会话就会使用它。
- 子 Agent 现在继承父会话已解析的 `(provider, model_id)` 二元组和生效的思考等级，不再回落到 Project 默认模型。工具调用里显式给出的二元组仍然优先。

### Web App

侧栏里的会话列表现在默认按 Workspace 分组。分组以目录名为标签，按最新会话排序，自动创建的临时 Workspace 合并为一个分组，不再一个会话一个分组。分组可以置顶，折叠状态按 Project 保存。子 Agent 和定时任务创建的会话会进入各自的文件夹，每个分组按需加载更多会话，不再一次拉取不限数量的列表。按 Agent 分组仍然只差一次切换。

模型下拉框现在优先列出已配置 key 的模型，其余的点一下就能展开。收起后的侧栏变成完整的八项导航栏，带中英双语悬浮提示，此前它完全没有 Benchmark 入口。自定义供应商分组与 Agent 改用首字母头像，底色由 id 派生，深浅两种主题下都满足 WCAG AA 对比度，不同分组里的同名模型也就能分辨了。

聊天渲染也做了一轮打磨：

- 链接在新标签页打开。
- 长 URL 与行内代码在容器边缘换行，同时不会把中文段落里的英文单词拦腰截断。
- 宽表格在消息内部横向滚动，不再把页面撑宽。
- 展开的子 Agent 对话渲染在工具调用自身输出的下方。
- 三个此前在移动端最多溢出视口 143px 的下拉面板，现在留在视口内。

**成本中心**的每日 Token 提示气泡会跟随指针，并显示缓存命中率。复制消息时生成的任务统计行此前是硬编码的中文，现在同样走词典。

### Skill

AI 应用开发分组新增三个 Skill：`vllm`、`ollama` 与 `llamafactory`。有了它们，Agent 不只是调用模型，还能把自己依赖的模型部署起来、调优出来。两个部署 Skill 共用同一套引导流程：先问要部署哪个模型，再问你偏好哪个引擎，然后部署、验证，最后用 CLI 注册端点。

`penguin-cli` Skill（现为 v5）与 `penguin-sdk` 承载了部署 Skill 所依赖的硬性规则：给 Penguin 自身配置模型用默认数据根目录，而为开发中的应用配置模型，必须写进那个应用自己的项目目录。我们另有一篇[实践文章](/blog/natural-language-training-loop)，讲 Agent 同时握有这三个 Skill 之后会发生什么变化：你不再敲命令，只描述你要的结果。

第四个 Skill `bento-slides` 进入办公效率分组。让 Agent 做演示文稿，它会产出一份真正的 Bento 幻灯片：一个自包含的 `.bento.html` 文件，文档本身就是 JSON。它把你的素材映射到图表、morph 转场和状态页，而不是堆一屏要点。这个 Skill 改编自 Bento 项目自己的 MIT 许可 Skill，并标注了出处。

`agenthub-models` 同步了 0.4.1 的变化：新的受支持模型注册表、客户端现在可能直接拒绝的配置参数，以及 Gemini 3.6、Kimi K3 和 GLM-5.2 系列和它们的推理强度设置。

### 站点、文档与工具

文档站和官网的导航栏此前逐渐分化成两份几乎相同的实现，现在共用同一套布局：同样的容器宽度、同样的 Logo 区块、同样的右侧按钮组。博客新增了**技术实践**分类、置顶文章，以及文章元信息：按语言格式化的日期、作者行和复制链接按钮。两份 README 与官网首页也在读者真正会去找的位置列出了内置 Skill。

README 路线图新增两项：Agent company and templates，以及 company-level self evolving。`examples/` 下的自我进化示例重写成两个可运行脚本，让本地开放权重模型给自己打分、修改自己的文件并重跑，而不再是一段固定的示意记录。服务端现在会校验分页与日期查询参数，不再照单全收。

## 升级

升级现在只需一条命令。`penguin update` 会查出最新版本，先说明接下来要做什么，再按你当初的安装方式原地升级：

- tarball 安装：重新执行官方安装脚本，保留原安装目录以及是否内置运行时的选择。
- npm、pnpm、yarn 或 bun 全局安装：用对应的包管理器重新全局安装。

源码检出的安装它会直接拒绝，你的数据目录它也从不触碰。`penguin update --check` 只报告版本，不做任何修改。

## 获取方式

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```

然后打开**模型仓库**页面，填入 Gemini 或 OpenRouter 的 API key，选择 `gemini-3.6-flash` 即可。完整的发布说明见 [`changelog/0.1.1/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.1.1)。
