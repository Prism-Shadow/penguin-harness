---
title: "Simple Harness Is All You Need：精简的 Harness 就够了"
date: 2026-07-22
category: practice
excerpt: Databricks 拿自家百万行代码库里的真实 PR，评测了多个 coding agent harness。最值得琢磨的数字跟模型无关——精简 harness 每轮只发出约三分之一的上下文，任务完成率却打平。本文讲清楚上下文纪律为什么胜过功能数量，以及 PenguinHarness 怎么把这个判断写进了代码。
---

聊 Agent 效果，聊着聊着往往就变成了聊模型：换个更强的模型，自然有更好的 Agent。但这几个月攒下来的证据，指向一个不太让人舒服的结论：**只要模型本身够用，包在它外面的那层东西，就决定了账单的大头，也决定了效果里相当可观的一部分。**

目前最清晰的证据来自 Databricks。在 [Benchmarking Coding Agents on Databricks' Multi-Million Line Codebase](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase) 里，他们横向评测了多个 agent harness 和多个模型，结论是：**固定模型、固定思考强度，只换 harness，单任务成本能差出两倍以上，而质量没有变化。**

这篇文章讲三件事：为什么会这样，精简究竟发生在哪几个地方，以及我们在 PenguinHarness 里是怎么做的。

## 一、Harness 的本质是一份上下文预算

先把概念说清楚，这个词平时用得太随意。

模型是 API 背后的一个函数。它接收 system prompt、一组工具定义、一段消息历史，返回文本和工具调用。这份契约是固定的，也是公开的。**除此之外的一切——所有决定"这个请求里放什么"的软件——就是 harness。**

所以一个 coding agent harness 实际上只做三件事：

- **组织上下文**：写 system prompt，决定每一轮让模型看到什么；
- **暴露工具**：定义模型能执行的动作，以及它们的 schema；
- **管理历史**：决定哪些原文留着、哪些压缩、哪些直接丢掉。

这三件事其实是同一类决策：**有限的上下文窗口，究竟被什么占着**。Harness 不是一张功能清单，而是一份替模型花出去的上下文预算，而且每一轮都要重花一次。

这个视角一下就解释了 Databricks 的结果：两个 harness 调的是同一个模型，跑的不是不同的智能，而是不同的预算。

## 二、证据

这套评测，Databricks 是用最费力也最诚实的办法做出来的。他们从自家生产级 monorepo 里挑出约一百个真实 Pull Request，覆盖 Scala、Rust、TypeScript、Go、Bazel、Protobuf 等十几种语言，只保留自包含、且有真实测试覆盖的改动。判分完全机械：让 Agent 自己声明完成，把此前抽走的测试恢复回去，跑一遍。

他们解释自己为什么不用当下流行做法的那句话，值得原样抄下来：

> 我们**没有**用 LLM judge 来判定正确性，因为我们发现那样会奖励"听起来对"，而不是"真的对"。

其中两个发现最关键。

**第一，harness 的选择，是和模型选择同一量级的成本杠杆。** 他们的原话是：同一个模型、同样的思考强度，分别跑在两个不同的 harness 上（Claude Code/Codex 对 Pi），单任务成本出现了显著差异，某些情况下超过两倍，而**质量保持不变**。

**第二，起作用的是上下文的体量，不是什么巧妙技巧：**

> Pi 每轮发送的上下文大约少三倍。它把工作集管得更紧，用更少的轮次完成了任务。

[Pi](https://github.com/earendil-works/pi) 是一个 MIT 协议的 Agent 工具包，它的 coding CLI 建立在一个刻意精简的内核上：读、写、编辑，加一个 shell。它并不比厂商自家的 harness 更强，只是更克制。而在这套评测里，克制比功能更值钱。

Databricks 自己很谨慎，我们也该同样谨慎：他们特意说明，这里的教训**不是**某个 harness 永远更便宜，也**不是**原生 harness 更差。功能丰富的 harness 换来的是实打实的东西。要点只在于：**这些功能不是免费的，它们按轮计费，而大多数团队从没看过这张账单。**

[SaladDay 的一篇拆解](https://x.com/Salad95238547/status/2079508549382644194)把这件事又推进了一步：他把两种设计并排读了一遍，归结为两个方向相反的赌注——**尽量把信息都送到模型面前，还是精挑细选之后再送**。这个框架很好，也正是我们设计时所对照的那一个。

## 三、重量到底堆在哪里

上下文膨胀很少源于一个糟糕的决定，而是四个各自都说得通的小决定，在每一轮里复利叠加。

**工具面。** 每个工具在**每一次**请求里都要付出名字、描述和完整 JSON Schema 的代价。三十个工具不等于三十份便利，而是一笔常驻的税，外加一个更大的、够模型迷路的决策空间。而那些边际工具，往往正是在重新实现 shell 早就有的能力。

**工具输出。** 一次依赖安装吐出几千行。这些输出不是只计费一次——它们会变成历史，在之后的每一轮里被重新发送。**不设上限的工具输出，是把小任务变成昂贵任务最快的途径。**

**System prompt。** 冗长的行为守则，编码的是模型本来就有的判断力。告诉一个前沿模型别硬编码密钥，等于花 token 复述它的训练数据。更微妙的是，规定得太细本身就带着一层言外之意：**详尽的规则等于在暗示模型的判断不被信任**，于是碰上规则没覆盖的情形，它反而更容易犹豫——而那恰恰是最需要它自己拿主意的时候。

**每轮注入。** 环境快照、状态块、被反复重发的配置文件，统统钉在每条消息上。单看微不足道，结构上却是永久的。

这些都不是错的想法，只是**没被定价**的想法。

## 四、PenguinHarness 是怎么做的

在这份评测出现之前，我们就下了"精简"这个赌注，而且它写在源码里，不在宣传页上。下面每个数字都能在仓库里核对。

### 六个工具，而且完全没有文件工具

PenguinHarness 内置 **6 个**工具（[参考文档](https://penguin.ooo/docs/tools)），任一会话实际只看到 5 个——两个图像工具互斥，按模型支不支持视觉来选。

| 工具 | 作用 |
| --- | --- |
| `exec_command` | 通过 `bash -lc` 执行 shell 命令，流式返回 stdout/stderr |
| `input_command` | 驱动运行中的命令：写 stdin、发送 Ctrl-C、轮询输出 |
| `run_subagent` | 把自包含的子任务委派给子 Agent |
| `input_subagent` | 轮询后台子 Agent，或者给它追加新指令 |
| `read_image` | 以图像内容返回图片（视觉模型） |
| `describe_image` | 交给配置好的视觉模型转成文字描述（纯文本模型） |

没有 read 工具，没有 write 工具，没有 edit 工具，没有 glob，也没有 grep。**读、写、编辑、搜索全部走 shell**——因为 shell 本来就能做这些，而模型本来就会用它。

这句话最能说清我们的立场：当一个四工具的"最小内核"把 read、write、edit 三个名额花在文件系统上时，**我们只花一个——`exec_command`**。剩下的预算留给 shell 确实做不到的能力：驱动交互式进程、委派子 Agent、处理图像。

| Harness | 文件系统 + shell | 暴露给模型的总数 |
| --- | --- | --- |
| PenguinHarness | 1 个（`exec_command`） | 每会话 5 个（共定义 6 个） |
| Pi | 4 个（read、write、edit、bash） | 4 工具内核 |
| 典型厂商 coding agent | 独立的 read/write/edit/glob/grep | 数十个，外加 MCP servers |

我们并不宣称绝对工具数最少，论内核，Pi 比我们还紧一个。我们宣称的是：**在"Agent 每天真正在做的事"——碰文件、跑命令——上，我们的 schema 面积最小。**

### 72 行的 System Prompt

默认 system prompt 模板在变量替换前是 **72 行、约 6,600 字符**（[`packages/core/src/state/default-config.ts`](https://github.com/Prism-Shadow/penguin-harness/blob/main/packages/core/src/state/default-config.ts)）。它覆盖角色、成功标准、硬约束、停止规则、文件系统布局，外加一小段建议工作流，然后就结束了。**它不去复述一个称职的模型早就知道的东西。**

### 输出上限是默认行为

每次工具调用都按 `maxOutputLength` 截断，**默认 16,000 字符**，而且由 Environment 统一执行，不交给各个工具自己看着办。退出码这类终止标记被追加在**截断窗口之外**，所以哪怕输出中段被砍掉，那条告诉模型"命令到底成没成"的关键信息依然还在。

### 用不到就不花钱的 Skills

Skills 是可复用的指令包，而系统里**没有 skill 工具**。System prompt 只带上每个已安装 skill 的名字和一行描述，正文等到需要时用一条普通 shell 命令读进来（[文档](https://penguin.ooo/docs/skills)）。**这次会话用不到的 skill，只花你一行的代价。**

### 压缩之后是一个干净的上下文

超过上下文阈值（默认 **128,000 tokens**）之后，引擎把历史摘要成 `<context_summary>`，然后在一个**全新的**模型上下文里继续，而不是把摘要接在一段已经臃肿的历史后面。于是一个 trace 文件恰好对应一个模型上下文，事后也完全可审计（[Agent Loop](https://penguin.ooo/docs/agent-loop)）。

### 干净的消息协议

我们不把环境元信息钉在用户消息上。模型收到的就是对话本身：用户轮、助手轮、工具结果。系统合成的记录当然存在——用于中断、传输重试和上下文压缩——但那是**三个有明确文档的标记**，而不是一条持续注入的状态流。

## 五、为什么"更少"反而赢

"上下文越多，决策越好"这个直觉并不蠢，只是在边际上不成立，原因有两个。

**注意力是固定预算，而且会被摊薄。** Self-attention 让每个 token 都要和其余所有 token 算权重。当请求从 20K tokens 涨到 60K，真正起决定作用的那部分——那条实际的报错、用户实际的约束——在注意力里占的份额就变小了。**五条被执行到位的规则，胜过五十条互相抢注意力的规则；五个被正确选中的工具，胜过三十个把搜索空间撑大的工具。**

**冗余指令的代价不止是 token。** 复述训练数据的规则不增加能力，只增加"这里不需要你判断"的暗示。它的失效模式不是模型违反规则，而是**模型在规则没覆盖的场景下卡住**。

还有第三个更实际的理由：**可移植性**。后训练绑定的是**协议**，不是 harness。所有严肃的模型都在同一套 function calling 契约上训练——JSON Schema 进，结构化调用出。从模型的角度看，一个精简的 harness 不过是一个恰好比较短的标准请求。这就解释了为什么评测里多家厂商的模型、加上开放权重的 GLM，在同一个精简 harness 下都表现不错，也说明**精简的设计最有可能在你换模型之后依然好用**。对于一个价值主张是"一套接口接 1000+ 模型"的项目，这不是锦上添花，是地基。

我们自己的评测数字落在那个位置，也是同一个道理。复杂数据分析上，PenguinHarness 搭配 DeepSeek V4 Pro 拿到了三者中最高的准确率（66.67%，两个对手各 53.33%），花费 **$0.55**，而 Claude Code 是 **$38.48**——同一套题，账单约为其 1/70。编程题上，我们和 OpenAI Codex 以 71.25% 打平，落后于 Claude Code 的 86.25%，但整套题我们花了 **$3.81**，它们分别是 **$220.08** 和 **$146.97**。我们并不宣称在每个维度上都赢过前沿模型，我们宣称的是：**效果的差距，比价格的差距小一到两个数量级。每轮更少的 token 不是审美偏好，它就是整个成本结构本身。**

## 六、精简不该牺牲什么

这里是我们和"极简主义"分道扬镳的地方。

要把 harness 削薄其实很容易，前提是你连"让一个自主进程敢在真机上跑"的那部分也一并砍掉。Pi 的 README 就坦率写明它**不包含内置权限系统**，并建议改用容器隔离。对个人 CLI 来说这是合理取舍，对企业不是。

PenguinHarness 把安全和可观测当成承重结构，而它们在上下文里几乎不花钱，恰恰因为**它们活在运行时，不活在 prompt 里**：

- **每次工具调用恰好触发一次审批决策**，共四种模式：全部允许、全部拒绝、只读放行、每次询问。SDK 在没有注入审批回调时**默认拒绝**，所以不会有东西在无人值守时意外跑起来；
- **每个决策都以 `approval_decision` 事件写入 Trace**，形成完整的审计记录；
- **工具永远不向引擎抛异常**。失败会收敛成模型读得懂、也能据此反应的工具输出——这也正是精简 prompt 依然安全的原因：**环境把自己的错误讲清楚了，prompt 就不必去替它预判。**

既不额外多花每轮的 token，又保持完全可审计，这才是重点。**上下文窗口里讲纪律，运行时里讲严谨。**

## 七、结论

Databricks 的结果值得推广到 coding agent 之外去理解：**模型固定时，是 harness 在定价。** 而那些在成本上胜出的 harness，不是靠更聪明赢的，**是靠发得更少赢的。**

如果你在构建 Agent，自检清单很直接：

- 你的模型看到多少个工具？其中多少个在重新实现 shell？
- 你的工具输出硬上限是多少？
- 你的 system prompt 里，有多少行在教模型它预训练时就学会的事？
- 每条消息里到底被注入了什么？

以上每一个答案，都是一个**按轮计费、贯穿整个任务生命周期**的成本项。

我们就是围着这张账单构建 PenguinHarness 的：六个工具、72 行 prompt、有上限的输出、按需加载的 skills，同时保留逐次审批和完整 Trace——因为**让 Agent 值得信任的那部分，恰恰是最不该砍的部分**。

---

- **上手**：`curl -fsSL https://penguin.ooo/install.sh | sh`，然后 `penguin web`
- **读实现**：[工具与审批](https://penguin.ooo/docs/tools) · [Agent Loop](https://penguin.ooo/docs/agent-loop) · [Skills](https://penguin.ooo/docs/skills)
- **来讨论**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**：[Databricks — Benchmarking Coding Agents on Databricks' Multi-Million Line Codebase](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase) · [Pi (earendil-works/pi)](https://github.com/earendil-works/pi) · [SaladDay《Less is More》](https://x.com/Salad95238547/status/2079508549382644194)
