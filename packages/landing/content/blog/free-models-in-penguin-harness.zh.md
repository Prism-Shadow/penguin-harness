---
title: PenguinHarness 免费模型介绍
date: 2026-07-24
category: news
excerpt: 预置目录现有四个免费的 OpenRouter 条目，其中三个是新加入的，一个免费的 OpenRouter API key 就能让 Agent 跑起来。本文介绍这套免费阵容、开启方法，以及免费档能提供什么、不能提供什么。
---

> 本文基于 PenguinHarness 0.1.2 撰写，之后的版本在部分细节上可能有所不同。

PenguinHarness 的预置目录现在带有免费模型：这些条目每百万 Token 价格为 $0，和其他预置条目一样，协议、base URL、价格和上下文窗口都已填好。要跑起一个 Agent，只需要一个 OpenRouter API key。创建 API key 本身免费，也不需要账户余额。

截至今天，免费阵容共四个条目，全部在 OpenRouter 分组下。Nemotron 3 Ultra 之前就在目录里，Ling 3.0 Flash、Laguna M.1 和 Free Models Router 是新加入的。

## 免费阵容

| 供应商分组 | 模型 ID                                  |            上下文 | 价格 |
| ---------- | ---------------------------------------- | ----------------: | ---- |
| OpenRouter | `nvidia/nemotron-3-ultra-550b-a55b:free` |         1,000,000 | $0   |
| OpenRouter | `inclusionai/ling-3.0-flash:free`        |           262,144 | $0   |
| OpenRouter | `poolside/laguna-m.1:free`               |           262,144 | $0   |
| OpenRouter | `openrouter/free`                        | 128,000（保守值） | $0   |

![模型仓库页面的 OpenRouter 分组：Ling 3.0 Flash (free)、Nemotron 3 Ultra (free)、Laguna M.1 (free) 和 Free Models Router 都带淡黄色的「免费」标签](/blog-assets/free-models-page-zh-light.webp)

## Nemotron 3 Ultra (free)

Nemotron 3 Ultra 是目录里的第一个免费条目，至今仍是最大的一个。它是 NVIDIA 面向推理与编排的开放前沿模型：MoE 架构，总参数 550B、激活参数 55B，采用 Transformer–Mamba 混合架构，上下文窗口 1M Token。想看看 Harness 里以规划为主的循环跑在大型推理模型上是什么样子，又不想付大型推理模型的价钱，就选这一条。

## Ling 3.0 Flash (free)

inclusionAI 在 7 月 23 日发布 Ling 3.0 Flash，第二天就进了目录。这是一个 124B 参数的 MoE 模型，每个 Token 只激活约 5.1B 参数。inclusionAI 给它定的设计重点是 Token 效率和生产规模的 Agent 推理，工具调用也包括在内。

这几乎就是 Agent Harness 每天在做的事：几十次短往返，每次都带着工具 Schema 和不断变长的对话记录，每一步的效率决定了成本。一个稀疏、针对工具调用调优、价格为 $0 的模型，很适合默认承接这类流量。上下文 262K，仅支持文本。

## Laguna M.1 (free)

Laguna M.1 和 Ling 同时进入目录。这一条是 Poolside 旗舰编码 Agent 模型的免费档。这个模型针对复杂的软件工程任务优化，擅长带工具调用和推理的 Agent 编码工作流，正是 Harness 产生的那类流量。上下文 262K，仅支持文本。

## Free Models Router

`openrouter/free` 不是一个模型，而是 OpenRouter 的统一免费端点：每个请求会随机发给 OpenRouter 上当前可用的某个免费模型，候选模型都支持这个请求需要的能力，比如工具调用或结构化输出。上游的免费模型来来去去，这个路由始终能响应，你不用自己盯着最新的模型清单。

目录为这一条做了两个决定，值得了解：

- **上下文窗口。** 实际接收请求的模型每次都可能不同，真实上下文窗口也随之变化，所以这一条刻意记录了保守值 128,000，而不是某个模型的真实窗口。这样长会话会提前压缩，不会一直增长到目标模型未必撑得住的长度。
- **仅支持文本。** 路由本身接受图片，但某次请求背后的模型未必支持。这一条特意标记为仅支持文本，所以 PenguinHarness 不会在这条路由上发送图片，而是改走平常的纯文本交接（文件路径加 `describe_image`）。

## 开启免费模型

1. 在 [openrouter.ai](https://openrouter.ai/) 创建 API key。免费档不需要绑定支付方式。
2. 打开**模型仓库**页面：
   - 新建的 Project 已经带有这些预置条目。在 OpenRouter 分组上点击**统一配置 API key**，粘贴一次 API key，整个分组都会生效。
   - 已有的 Project 点一下搜索框旁的**同步预置**，就能拿到新条目。本地添加的模型和已保存的 API key 都不受影响。
3. 也可以在终端里添加模型：

   ```bash
   penguin config model add --provider openrouter --model-id inclusionai/ling-3.0-flash:free --api-key <your-key> --set-default
   penguin config model list
   ```

可以把某个免费条目设为 Project 的默认模型；也可以不动默认模型，开始会话时在模型选择器里选一个免费条目。模型按会话选择，不绑定 Agent。免费条目在**模型仓库**页面和模型选择器里都带淡黄色的**免费**标签，很容易认出来。

## 免费能提供什么，不能提供什么

免费模型足以完整体验 Harness：Workspace、工具、Skill、子 Agent，还有显示 $0 的**成本中心**。轻量的自动化任务也可以交给它们。需要注意的限制如下：

- **速率限制。** OpenRouter 免费档限制每分钟和每天的请求数。一次长会话或一轮 Benchmark 运行就可能碰到上限。
- **数据政策。** 免费模型按 OpenRouter 的免费模型条款运行，上游供应商可能在自家条款允许的范围内使用你发送的提示词。不愿公开的内容不要发送。
- **可用性和质量有波动。** 免费容量取决于供应商愿意提供多少。模型会变忙、变慢，也会下线。
- **路由目标每次请求都在变。** 真实上下文窗口也随之变化，所以目录记录的是保守窗口，长会话会提前压缩。`openrouter/free` 本来就不追求一致性：固定使用一个免费条目会更稳定，付费条目最稳定。

正式的工作请选付费模型，同一份目录里有很多。

## 获取方式

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

然后打开**模型仓库**页面，填入 OpenRouter API key，选一个免费条目。
