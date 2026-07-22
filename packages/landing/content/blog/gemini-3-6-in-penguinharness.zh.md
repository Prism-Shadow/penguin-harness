---
title: Gemini 3.6 Flash 与 3.5 Flash-Lite 已接入 PenguinHarness——以及 0.1.1 的其余更新
date: 2026-07-22
category: news
excerpt: Google 于 7 月 21 日发布 Gemini 3.6 Flash 与 3.5 Flash-Lite，两者已进入 PenguinHarness 模型目录——Google 直连与 OpenRouter 两条路径都可用，1,048,576 Token 上下文、支持视觉。本文介绍新模型带来了什么，以及围绕它的 0.1.1 版本还改了哪些地方。
---

Google 在 2026 年 7 月 21 日发布了 [Gemini 3.6 Flash、3.5 Flash-Lite 与 3.5 Flash Cyber](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/)。一天之后，前两个已经出现在 PenguinHarness 的模型目录里——在 Models 页面选中、填入 Key，即可运行。本文先讲新模型对 Agent 负载究竟意味着什么，再梳理 **0.1.1** 这个版本的其余更新。

## 为什么 Flash 这一代对 Harness 特别重要

Google 对这次发布的定位，恰好就是 Harness 每天在做的事：「构建生产级 AI Agent 的开发者与客户，需要更高的 Token 效率、更低的延迟和更可靠的表现。」Agent 循环不是一次长补全，而是几十次短往返，每一次都带着工具 Schema、不断增长的对话记录和一份推理预算。单步效率就是全部的成本模型。

Gemini 3.6 Flash 的收益正落在这里。按 Google 的说法，在 Artificial Analysis Index 上它比 3.5 Flash **少消耗 17% 的输出 Token**，在 Datacurve 的 DeepSWE 等部分基准上观察到「最高 65%」，并且「完成多步工作流所需的推理步数与工具调用更少」。与此同时价格**低于 3.5 Flash**：输入 $1.50 / 百万 Token，输出 $7.50 / 百万 Token。

更少的 Token、更少的步数、更低的单价。对于每一轮都要重跑一遍评测集的自我进化循环来说，这三者是叠乘关系。

![Gemini 3.6 Flash 评测图：DeepSWE v1.1、MLE-Bench、GDPval-AA v2 与 OSWorld-Verified 四项，逐项对比 Gemini 3.1 Pro、3.5 Flash 与 3.6 Flash](/blog-assets/gemini-3-6-flash-evals.webp)

*图片版权归 Google 所有，转载自其发布博客 [Introducing Gemini 3.6 Flash, 3.5 Flash-Lite, and 3.5 Flash Cyber](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/)（2026 年 7 月 21 日）。图中全部数据与评测方法均出自 Google，而非我们自测。*

难得的是，质量并没有为效率让路。对比 3.5 Flash，Google 给出的数据是：

| 基准             | 衡量的能力   | 3.5 Flash | 3.6 Flash |
| ---------------- | ------------ | --------: | --------: |
| DeepSWE v1.1     | 长程软件工程 |       37% |       49% |
| MLE-Bench        | 机器学习工程 |     49.7% |     63.9% |
| GDPval-AA v2     | 知识工作     |      1349 |      1421 |
| OSWorld-Verified | 计算机操作   |     78.4% |     83.0% |

Google 把 DeepSWE 的提升归因于「更高的精确度、更少的多余代码改动和更少的执行循环」——任何看过 Agent 在代码仓库里反复折腾的人都认得这个失败模式。计算机操作现在是 Gemini API 与 Gemini Enterprise 中的内置客户端工具；模型还带上了针对 CBRN 与网络攻击滥用的 Frontier Safety 加固，Google 称其「明显更难被越狱」，同时减少了对正当用途的拒答。

## 3.5 Flash-Lite：便宜且快的那一半

Gemini 3.5 Flash-Lite 是这次发布的另一半，目标是吞吐：按 Artificial Analysis 的测量，它是 3.5 系列中最快的模型，达到 **350 输出 Token/秒**，定价 **输入 $0.30 / 百万 Token、输出 $2.50 / 百万 Token**。Google 把它定位在 Agent 检索、文档处理这类高吞吐场景，并支持配置思考等级——同一个模型既可以压到低延迟低成本跑批量任务，也可以调高思考等级承担多步子 Agent 负载。计算机操作在这里同样是内置工具。

与上一代 Flash-Lite 相比，Google 给出的数据是：Terminal-Bench 2.1 **54% 对 31%**，长上下文 GDM-MRCR v2 **72.2% 对 60.1%**，GDPval-AA v2 **1140 对 642**。在若干 Agent 与编码评测上它甚至超过 3 Flash——SWE-Bench Pro **54.2% 对 49.6%**，OSWorld-Verified **74.0% 对 65.1%**。

这个组合非常适合子 Agent 模式：能力更强的父模型负责规划，便宜且快的模型负责扇出执行。Google 自己的博客展示的也是同一形态——3.5 Flash-Lite「与作为主控 Agent 的 3.6 Flash 协同工作」。

发布中的第三个模型 3.5 Flash Cyber 则刻意不对外开放：Google 表示它将仅通过 CodeMender、以限量试点计划的形式提供给政府与可信合作伙伴。PenguinHarness——以及任何其他工具——都不会有机会把 base URL 指过去。

## PenguinHarness 里现在能用到什么

两个模型在 0.1.1 中各有两条接入路径：

| 提供方分组    | 模型 ID                        |    上下文 | 视觉 |
| ------------- | ------------------------------ | --------: | ---- |
| Google Gemini | `gemini-3.6-flash`             | 1,048,576 | 支持 |
| Google Gemini | `gemini-3.5-flash-lite`        | 1,048,576 | 支持 |
| OpenRouter    | `google/gemini-3.6-flash`      | 1,048,576 | 支持 |
| OpenRouter    | `google/gemini-3.5-flash-lite` | 1,048,576 | 支持 |

Google 直连的两行由模型 ID 自动路由，只需要一个 `GEMINI_API_KEY`；OpenRouter 的两行已经内联了 OpenAI 客户端类型与网关 base URL，只需要一个 OpenRouter Key。最快的路径是 Web App 的 **Models** 页面：找到那一行，填 Key，结束。命令行则是一条命令：

```bash
penguin config model add --provider google --model-id gemini-3.6-flash --api-key <your-key>
penguin config model list
```

随之落地的还有两处修正。Gemini 的价格现在按厂商真实的缓存命中价记录，而不是把输入价重复填进缓存桶——3.6 Flash 每百万缓存输入 Token $0.15，3.5 Flash-Lite $0.03——费用中心因此不再把缓存密集型开销高估一个数量级。另外 `google/gemini-3.5-flash` 的上下文窗口此前记为 1,000,000，网关与直连端点的真实值都是 1,048,576，现已更正。

## 0.1.1 的其余更新

Gemini 这两行只是一次更大规模目录刷新中的一条，而目录也只是这个版本触及的诸多面之一。

### 模型与内核

SDK 升级到 **AgentHub 0.4.1**。这是一次类型兼容的升级，它新增的受支持模型注册表——模型、base URL 与 client 三元组，附带模态、上下文窗口和每百万 Token 价格——成了这次目录比对的权威来源。目录条目从 59 条增加到 70 条：上文两个 Gemini 模型的两条路径，Anthropic 的 Claude Fable 5 与 Claude Sonnet 5，Moonshot 的 Kimi K3，OpenRouter 的 Kimi K2.6、Qwen3.6 35B A3B 与 GLM 5.1，以及 SiliconFlow 上的同样三个。最后三个刻意不带价格：没有任何来源公布它们的费率，而猜一个数字比留空更糟。所有上下文窗口、视觉标记与价格都来自注册表，而不是厂商的宣传页。

如果你把 Agent 跑在本地或严格的端点上，有三处修复值得注意：

- **空工具列表不再发到线上。** 严格的 OpenAI 兼容服务会直接拒绝 `tools: []`——vLLM 会回 `400 … tools must not be an empty array`。Harness 所有不带工具的请求（连通性探测、会话标题生成、视觉描述）此前都会撞上它。现在列表为空时该字段被整个省略。
- **最大输出 Token 成为模型级设置。** 本地部署的 32k 上下文模型会直接拒绝请求，因为 Agent 级默认值要求 32,000 个输出 Token。Models 页面与 `penguin config model add --max-tokens` 现在支持按模型设置上限，其优先级高于 Agent 默认值，带外请求则取两者中较小的一个。
- **默认系统提示词加了护栏。** Agent 为了腾出被占端口而杀掉监听进程时，有时杀掉的是 Harness 自己的服务；提示词现在要求：绝不杀死不是自己启动的进程，端口被占就另选一个空闲端口。遇到 401/403 或无效 Key 时，Agent 最多重试一次，随后停止并请用户在对话之外更新 Key——密钥不该出现在聊天记录里。已有 Agent 保留当前提示词，新建的 Agent 才带上这些规则。

还有两项运行时设置换了形态。思考等级从 Models 页面挪到了对话草稿区、模型选择器旁的紧凑选择器（`low` / `medium` / `high` / `xhigh`），并即时写回 Agent 设置，使发送时创建的会话就用新值。子 Agent 现在继承父会话已解析的 `(provider, model_id)` 二元组与生效的思考等级，不再回落到 Project 默认模型；工具调用里显式给出的完整二元组仍然优先。

### Web App

聊天侧边栏默认**按 Workspace 分组**：以目录名作为标签、按最新会话排序，自动创建的临时 Workspace 收敛成单个分组而不是一个会话一个分组。分组可以置顶，折叠状态按 Project 持久化，子 Agent 与定时任务创建的会话进入各自的文件夹，每个分组按页加载而不再一次拉取全部列表。按 Agent 分组仍然只差一次切换。

模型下拉框现在优先列出真正配置了 Key 的模型，其余的收在下面一行。折叠后的侧边栏变成了完整的八项导航栏，带中英双语悬浮提示（Benchmark 此前完全缺失）。自建模型分组与 Agent 改用首字母头像——底色由名称派生，深浅色模式下都满足 WCAG AA 对比度——同名模型跨分组终于能分辨了。

聊天渲染也做了一轮：链接在新标签页打开；长 URL 与行内代码在容器边缘换行，同时不会把中文段落里的英文单词拦腰截断；宽表格在消息内部横向滚动而不是把页面撑宽；展开的子 Agent 对话渲染在工具调用自身输出的下方；三个此前在移动端最多溢出 143px 的下拉面板现在留在视口内。费用中心的每日 Token 提示气泡跟随指针并显示缓存命中率；复制消息时生成的任务统计行此前是硬编码中文，现在同样走词典。

### 技能

AI 应用开发分组新增三个技能——**vllm**、**ollama** 与 **llamafactory**——让 Agent 不只是调用模型，还能把自己依赖的模型部署起来、调优出来。两个部署技能共享同一套引导流程：先问要部署哪个模型、再问用户偏好哪个引擎，然后部署、验证，最后用 CLI 注册端点。`penguin-cli`（现为 v5）与 `penguin-sdk` 承载了它们所依赖的硬性规则：给 Penguin 自身配置模型用默认数据根目录，而为在开发的 AI 应用配置模型必须写进该应用自己的项目目录。我们另有一篇[实践文章](/blog/local-models-and-the-tuning-loop)完整讲这三个技能怎么串起来用。

`agenthub-models` 同步了 0.4.1：新的受支持模型注册表、客户端现在可能直接拒绝的配置参数，以及 Gemini 3.6 / Kimi K3 / GLM-5.2 系列及其推理强度旋钮。

### 站点、文档与工程

文档站与官网的导航栏现在是同一套布局——同样的容器宽度、同样的 Logo 区块、同样的右侧集群——此前它们已经漂移成两份近乎相同的实现。博客新增 **Tech practice** 分类、置顶文章，以及文章元信息（按语言格式化的日期、作者行、复制链接按钮）。两份 README 与官网首页也在人们真正会去找的位置列出了内置技能。

README 路线图新增两项——Agent company and templates，以及 company-level self evolving；`examples/` 下的自我进化示例重写成两个可运行脚本，让本地开源权重模型真正给自己打分、改自己的文件并重跑，而不再是一段固定的示意记录。加固方面，服务端现在校验分页与日期查询参数而不是照单全收，两个此前没有直接测试覆盖的内核模块补上了单元测试。

## 获取方式

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```

然后打开 Models 页面，填入 Gemini 或 OpenRouter 的 Key，选择 `gemini-3.6-flash` 即可。完整的发布说明见 [`changelog/0.1.1/`](https://github.com/Prism-Shadow/penguin-harness/blob/main/changelog/0.1.1/README.md)。
