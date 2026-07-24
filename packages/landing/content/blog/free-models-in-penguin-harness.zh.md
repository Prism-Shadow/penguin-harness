---
title: PenguinHarness 免费模型：零成本跑起完整的 Agent Harness
date: 2026-07-24
category: news
excerpt: 预置目录现有三条 $0 价格的 OpenRouter 条目——已有的 Nemotron 3 Ultra (free)，以及新增的 Ling 3.0 Flash (free) 与 Free Models Router。一个免费注册的 OpenRouter API Key 就能把 Agent 跑起来，无需充值。本文介绍这套免费阵容、开启方式，以及免费档能换来什么、换不来什么。
---

试用一个 Agent Harness，不应该从充值开始。PenguinHarness 的预置目录里带着免费模型：每百万 Token 价格为 $0 的模型行，和其他预置条目一样填好了协议、base URL、价格与上下文窗口——你与一个跑起来的 Agent 之间，只隔着一个 OpenRouter API Key，而注册它本身也是免费的。

截至今天，免费阵容共三条，全部在 OpenRouter 分组下：

| 提供方分组 | 模型 ID                                  |     上下文 | 价格 |
| ---------- | ---------------------------------------- | ---------: | ---- |
| OpenRouter | `nvidia/nemotron-3-ultra-550b-a55b:free` |  1,000,000 | $0   |
| OpenRouter | `inclusionai/ling-3.0-flash:free`        |    262,144 | $0   |
| OpenRouter | `openrouter/free`                        | 随路由变化 | $0   |

## Nemotron 3 Ultra (free)

目录里的第一条免费行，也仍是最大的一条：NVIDIA 的开放前沿推理与编排模型，MoE 架构，总参数 550B、每 Token 激活 55B，混合 Transformer–Mamba，上下文窗口 1M Token。想看看 Harness 的重规划循环跑在大推理模型上是什么样、又不想付大推理模型的价格，就选这一行。

## 新增：Ling 3.0 Flash (free)

inclusionAI 于 7 月 23 日发布，次日进入目录。Ling-3.0-flash 是一个 124B 参数的 MoE 模型，每个 Token 只激活约 5.1B 参数；inclusionAI 给它的设计目标是 Token 效率与生产规模的 Agent 推理，含工具调用。这几乎就是在描述一个 Agent Harness 每天做的事：几十次短往返，每一次都带着工具 Schema 和不断增长的对话记录，单步效率就是全部的成本模型。一个稀疏、面向工具调用调优、价格为 $0 的模型，正适合承接这类流量。上下文 262K，仅文本。

## 新增：Free Models Router

`openrouter/free` 不是一个模型，而是 OpenRouter 的统一免费端点：每个请求被随机路由到 OpenRouter 上当前可用的某个免费模型，并按请求真正需要的能力过滤——工具调用、结构化输出等。上游的免费模型来来去去，这个路由始终有答案，你不必自己盯着最新清单。

有两个目录层面的决定值得说明。这一行不记录上下文窗口，因为被路由到的目标随请求变化。它也被刻意标记为仅文本：路由本身接受图片，但任一请求背后的模型未必支持，所以 PenguinHarness 不向这条路由发送图片，改走常规的纯文本交接（文件路径加 `describe_image`）。

## 开启方式

1. 在 [openrouter.ai](https://openrouter.ai/) 注册并创建 API Key——免费档不需要绑定支付方式。
2. 新建 Project 自带这些预置条目：打开 **Models** 页面，用 OpenRouter 分组的批量填 Key 按钮贴上 Key 即可。已有 Project 点一下搜索框旁的**同步预置**就能拿到新行——本地添加的模型与已存凭证都不会被动到。
3. 也可以走终端：

```bash
penguin config model add --provider openrouter --model-id inclusionai/ling-3.0-flash:free --api-key <your-key> --set-default
penguin config model list
```

把某条免费行设为 Project 默认，或者不动默认、在创建会话时于模型选择器里现选一条——模型按 Session 选择，不绑定 Agent。

## 免费换来什么，换不来什么

把话说在前面：

- **速率限制。** OpenRouter 免费档限制每分钟与每天的请求数；一段长 Agent 会话或一轮评测就可能碰到上限。
- **数据政策。** 免费模型按 OpenRouter 的免费模型条款运行，Prompt 可能在条款允许的范围内被上游用于训练等用途。不要发送任何你不愿意公开的内容。
- **可用性与质量会波动。** 免费容量取决于提供方的意愿；模型会变忙、变慢，也会下线。
- **路由目标逐请求变化。** 一致性不是 `openrouter/free` 的目标；固定选一条免费行会更一致，付费行最一致。

免费模型足以真实地体验完整的 Harness——Workspace、工具、Skill、子 Agent，以及费用中心里干干净净的 $0——也能承担轻量自动化。正经的工作请换付费模型，同一份目录里有的是。

## 获取方式

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```

然后打开 Models 页面，填入 OpenRouter Key，选一条免费行。
