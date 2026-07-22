---
title: "Simple Harness Is All You Need：精简的 Harness 就够了"
date: 2026-07-22
category: practice
excerpt: Databricks 用自家百万行代码库的真实 PR 评测了多个 coding agent harness。最值得注意的数字与模型无关——精简 harness 每轮只发送约三分之一的上下文，任务完成率却持平。本文讲清楚为什么上下文纪律胜过功能数量，以及 PenguinHarness 如何把这个判断写进了代码。
---

关于 Agent 效果的讨论，大多最后都变成了关于模型的讨论：换更强的模型，得到更好的 Agent。但过去几个月积累的证据指向一个不太舒服的结论：只要模型本身够用，**包在模型外面的那层东西，决定了你账单的大部分，也决定了效果中相当可观的一部分**。

目前最清晰的证据来自 Databricks。在 [Benchmarking Coding Agents on Databricks' Multi-Million Line Codebase](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase) 中，他们横向评测了多个 agent harness 与多个模型，发现：**固定模型、固定思考强度，只换 harness，单任务成本的差距可以超过 2 倍，而质量没有变化**。

这篇文章讲三件事：为什么会这样，精简究竟发生在哪些地方，以及我们在 PenguinHarness 里怎么做的。

## 一、Harness 的本质是一份上下文预算

先厘清概念，因为这个词经常被含混使用。

模型是 API 背后的一个函数。它接收 system prompt、一组工具定义、一段消息历史，返回文本和工具调用。这份契约是固定且公开的。**除此之外的一切——所有决定"这个请求里放什么"的软件——就是 harness。**

所以一个 coding agent harness 实际只做三件事：

- **组织上下文**：撰写 system prompt，决定每轮让模型看到什么；
- **暴露工具**：定义模型可执行的动作及其 schema；
- **管理历史**：决定哪些原文保留、哪些压缩、哪些丢弃。

这三件事其实是同一类决策：**有限的上下文窗口被什么占据**。Harness 不是一张功能清单，而是一份代表模型花出去的上下文预算——每一轮都要花一次。

这个视角直接解释了 Databricks 的结果：两个 harness 调用同一个模型，跑的不是不同的智能，而是不同的预算。

## 二、证据

Databricks 用了最费力也最诚实的做法建这套评测。他们从自家生产级 monorepo 里挑出约一百个真实 Pull Request，覆盖 Scala、Rust、TypeScript、Go、Bazel、Protobuf 等十余种语言，只保留自包含且有真实测试覆盖的改动。判分完全机械：让 Agent 自己声明完成，恢复此前抽走的测试，跑一遍。

他们拒绝时下流行做法的那句说明，值得完整引用：

> "We did _not_ use an LLM judge to evaluate correctness, since we've found that this rewards sounding right over being right."
>
> （我们没有用 LLM judge 判定正确性，因为我们发现那会奖励"听起来对"，而不是"真的对"。）

其中两个发现最关键。

**Harness 的选择，是与模型选择同一量级的成本杠杆。** 原文：

> "When we ran the same model with the same thinking effort through two different harnesses (Claude Code/Codex vs Pi), we observed that the cost per task differed significantly (more than 2x in some cases), while quality remained the same."

**而其机制是上下文体量，不是什么巧妙技巧：**

> "Pi sent about 3x less context per turn. It managed context better, keeping a tighter working set and finishing the tasks in fewer runs."
>
> （Pi 每轮发送的上下文大约少 3 倍。它把工作集管得更紧，用更少的轮次完成了任务。）

[Pi](https://github.com/earendil-works/pi) 是一个 MIT 协议的 Agent 工具包，其 coding CLI 建立在一个刻意精简的内核之上：读、写、编辑，加一个 shell。它并不比厂商自家的 harness 更强，它只是更克制——而在这套评测里，克制比功能更值钱。

Databricks 自己很谨慎，我们也应该同样谨慎：*"The lesson here isn't that one harness is always cheaper or that native harnesses are worse."*（这里的教训不是某个 harness 永远更便宜，也不是原生 harness 更差。）功能丰富的 harness 换来的是实实在在的东西。要点在于：**这些功能不是免费的，它们按轮计费，而大多数团队从没看过这张账单。**

[SaladDay 的一篇拆解](https://x.com/Salad95238547/status/2079508549382644194)把这一点推得更远，把两种设计并排读，概括为两种相反的赌注：**尽可能多地把信息送到模型面前，还是精挑细选之后再送**。这个框架很好，也正是我们设计时所对照的那一个。

## 三、重量到底堆在哪里

上下文膨胀很少来自一个糟糕的决定，而是四个各自都说得通的小决定，在每一轮里复利叠加。

**工具面。** 每个工具在**每一次**请求里都要付出名字、描述和完整 JSON Schema 的代价。三十个工具不是三十个便利，而是一笔常驻税，外加一个更大的决策空间供模型迷路。而那些边际工具，往往正是在重新实现 shell 早就有的能力。

**工具输出。** 一次依赖安装吐出几千行。这些输出不是只计费一次——它们变成历史，在之后的每一轮里被重新发送。**不设上限的工具输出，是把小任务变成昂贵任务最快的方式。**

**System prompt。** 冗长的行为守则，编码的是模型本来就具备的判断力。告诉一个前沿模型不要硬编码密钥，是在花 token 复述它的训练数据。更微妙的是，过度规定带有一层言外之意：**详尽的规则暗示模型的判断不被信任**，于是在规则没覆盖到的情形下，它反而更容易犹豫——而那恰恰是最需要它自主判断的时候。

**每轮注入。** 环境快照、状态块、被反复重发的配置文件，一律钉在每条消息上。单个看微不足道，结构上却是永久的。

这些都不是错误的想法，它们只是**没有被定价**的想法。

## 四、PenguinHarness 是怎么做的

在这份评测出现之前，我们就下了"精简"这个赌注，而且它写在源码里，不在宣传页上。下面每个数字都可以在仓库中核对。

### 六个工具，且完全没有文件工具

PenguinHarness 内置 **6 个**工具（[参考文档](https://penguin.ooo/docs/tools)），而任一会话实际只看到 5 个——两个图像工具互斥，按模型是否支持视觉来选择。

| 工具 | 作用 |
| --- | --- |
| `exec_command` | 通过 `bash -lc` 执行 shell 命令，流式返回 stdout/stderr |
| `input_command` | 驱动运行中的命令：写 stdin、发送 Ctrl-C、轮询输出 |
| `run_subagent` | 把自包含的子任务委派给子 Agent |
| `input_subagent` | 轮询后台子 Agent，或向其追加新指令 |
| `read_image` | 以图像内容返回图片（视觉模型） |
| `describe_image` | 交由配置的视觉模型转成文字描述（纯文本模型） |

没有 read 工具，没有 write 工具，没有 edit 工具，没有 glob，没有 grep。**读、写、编辑、搜索全部走 shell**——因为 shell 本来就能做，而模型本来就会用。

这是表述我们立场最锋利的方式：当一个四工具的"最小内核"把 read、write、edit 三个名额花在文件系统上时，**我们只花一个——`exec_command`**。剩下的预算留给 shell 确实做不到的能力：驱动交互式进程、委派子 Agent、处理图像。

| Harness | 文件系统 + shell | 暴露给模型的总数 |
| --- | --- | --- |
| PenguinHarness | 1 个（`exec_command`） | 每会话 5 个（共定义 6 个） |
| Pi | 4 个（read、write、edit、bash） | 4 工具内核 |
| 典型厂商 coding agent | 独立的 read/write/edit/glob/grep | 数十个，外加 MCP servers |

我们并不宣称绝对工具数最少——论内核，Pi 比我们还紧一个。我们宣称的是：**在"Agent 每天真正在做的事"——碰文件、跑命令——上，我们的 schema 面积最小。**

### 72 行的 System Prompt

默认 system prompt 模板在变量替换前是 **72 行、约 6,600 字符**（[`packages/core/src/state/default-config.ts`](https://github.com/Prism-Shadow/penguin-harness/blob/main/packages/core/src/state/default-config.ts)）。它覆盖角色、成功标准、硬约束、停止规则、文件系统布局，以及一小段建议工作流——然后就结束了。**它不复述一个称职的模型早已知道的东西。**

### 默认就有输出上限

每次工具调用都按 `maxOutputLength` 截断，**默认 16,000 字符**，且由 Environment 统一执行，而不是交给每个工具各自处理。退出码这类终止标记被追加在**截断窗口之外**——所以即使输出中段被砍掉，那条告诉模型"命令是否成功"的关键信息依然幸存。

### 用不到就不花钱的 Skills

Skills 是可复用的指令包，而系统里**没有 skill 工具**。System prompt 只携带每个已安装 skill 的名字和一行描述，正文在需要时用一条普通 shell 命令读取（[文档](https://penguin.ooo/docs/skills)）。**本次会话用不到的 skill，只花你一行的代价。**

### 压缩后是一个干净的上下文

超过上下文阈值（默认 **128,000 tokens**）后，引擎把历史摘要成 `<context_summary>`，并在一个**全新的**模型上下文里继续，而不是把摘要追加到一段已经臃肿的历史后面。因此一个 trace 文件恰好对应一个模型上下文，事后也完全可审计（[Agent Loop](https://penguin.ooo/docs/agent-loop)）。

### 干净的消息协议

我们不把环境元信息钉在用户消息上。模型收到的就是对话本身：用户轮、助手轮、工具结果。系统合成的记录是存在的——用于中断、传输重试和上下文压缩——但那是**三个有明确文档的标记**，而不是一条持续注入的状态流。

## 五、为什么"更少"反而赢

"上下文越多决策越好"这个直觉不蠢，它只是在边际上是错的，原因有二。

**注意力是固定预算，而且会被摊薄。** Self-attention 让每个 token 与所有其他 token 计算权重。当请求从 20K tokens 涨到 60K，真正起决定作用的部分——那条实际的报错、用户实际的约束——在模型注意力中占的份额就变小了。**五条被执行的规则胜过五十条互相竞争的规则；五个被正确选中的工具胜过三十个把搜索空间撑大的工具。**

**冗余指令的代价不止是 token。** 复述训练数据的规则不增加能力，只增加"这里不需要你判断"的暗示。它的失效模式不是模型违反规则，而是**模型在规则没覆盖的场景下卡住**。

还有第三个更实际的理由：**可移植性**。后训练绑定的是**协议**，不是 harness。所有严肃的模型都在同一套 function calling 契约上训练——JSON Schema 进，结构化调用出。从模型的角度看，一个精简的 harness 不过是一个恰好比较短的标准请求。这解释了为什么评测中多家厂商的模型、加上开放权重的 GLM，在同一个精简 harness 下表现都不错——也说明**精简的设计最有可能在你换模型之后依然好用**。对于一个价值主张是"一套接口接 1000+ 模型"的项目，这不是锦上添花，而是地基。

这也是我们自己的评测数字落在那个位置的原因。在复杂数据分析上，PenguinHarness 搭配 DeepSeek V4 Pro 取得了三者中最高的准确率（66.67% 对两个对手各 53.33%），花费 **$0.55**，而 Claude Code 是 **$38.48**——同一套题，账单约为其 1/70。编程题上，我们与 OpenAI Codex 以 71.25% 持平，落后于 Claude Code 的 86.25%，但整套题我们花了 **$3.81**，而它们分别是 **$220.08** 和 **$146.97**。我们并不宣称在每个维度上都赢过前沿模型，我们宣称的是：**效果的差距比价格的差距小一到两个数量级。每轮更少的 token 不是审美偏好，它就是整个成本结构本身。**

## 六、精简不该牺牲什么

这里是我们与"极简主义"分道扬镳的地方。

如果连"让一个自主进程敢在真实机器上运行"的那部分也一并砍掉，把 harness 削薄是很容易的。Pi 的 README 就坦率地写明它 *"does not include a built-in permission system"*（不包含内置权限系统），并建议改用容器隔离。对个人 CLI 而言这是合理的取舍，但对企业不是。

PenguinHarness 把安全与可观测当作承重结构——而它们在上下文里几乎不花钱，恰恰因为**它们活在运行时，而不是活在 prompt 里**：

- **每次工具调用恰好触发一次审批决策**，共四种模式：全部允许、全部拒绝、只读放行、每次询问。SDK 在未注入审批回调时**默认拒绝**，所以不会有东西在无人值守时意外执行；
- **每个决策都以 `approval_decision` 事件写入 Trace**，形成完整审计记录；
- **工具永不向引擎抛异常**。失败会收敛成模型可读、可反应的工具输出——这也正是精简 prompt 依然安全的原因：**环境把自己的错误讲清楚了，prompt 就不必去预判它们。**

每轮零额外 token，同时保持完全可审计，这正是重点所在。**上下文窗口里讲纪律，运行时里讲严谨。**

## 七、结论

Databricks 的结果值得推广到 coding agent 之外去理解：**模型固定时，harness 定价。** 而那些在成本上胜出的 harness，不是靠更聪明赢的，**它们是靠发得更少赢的。**

如果你在构建 Agent，自检清单很直接：

- 你的模型看到多少个工具？其中多少个在重新实现 shell？
- 你的工具输出硬上限是多少？
- 你的 system prompt 里有多少行在教模型它预训练时就学会的事？
- 每条消息里被注入了什么？

以上每一个答案都是一个**按轮计费、贯穿整个任务生命周期**的成本项。

我们围绕这张账单构建了 PenguinHarness：六个工具、72 行 prompt、有上限的输出、按需加载的 skills——同时保留逐次审批与完整 Trace，因为**让 Agent 值得信任的那部分，恰恰是不值得砍掉的部分**。

---

- **上手**：`curl -fsSL https://penguin.ooo/install.sh | sh`，然后 `penguin web`
- **读实现**：[工具与审批](https://penguin.ooo/docs/tools) · [Agent Loop](https://penguin.ooo/docs/agent-loop) · [Skills](https://penguin.ooo/docs/skills)
- **来讨论**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**：[Databricks — Benchmarking Coding Agents on Databricks' Multi-Million Line Codebase](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase) · [Pi (earendil-works/pi)](https://github.com/earendil-works/pi) · [SaladDay《Less is More》](https://x.com/Salad95238547/status/2079508549382644194)
