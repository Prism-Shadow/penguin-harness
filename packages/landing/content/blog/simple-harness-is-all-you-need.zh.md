---
title: "精简的 Harness 就够了"
date: 2026-07-22
category: perspectives
excerpt: Databricks 拿约一百个真实 Pull Request 评测编程 Agent，通过率最高的是最简单的 Harness，成本还只有一半左右。本文认为 Harness 本质上是一份上下文预算，并介绍 PenguinHarness 如何围绕这个判断构建。
---

> 本文基于 PenguinHarness 0.1.1 撰写，之后的版本在部分细节上可能有所不同。

**Agent Harness** 是包在语言模型外面的那层软件，决定每次请求里放什么：系统提示词、工具定义和消息历史。按常见的直觉，Harness 越大，Agent 越强。工具更多、上下文更全、脚手架更厚，决策理应更好，整个品类就是建立在这个信念上的。

本文的观点正好相反。Databricks 用真实 Pull Request 做了一次评测，最简单的 Harness 拿到最高分，成本还只有一半左右；Databricks 把原因归结为它每轮发送的上下文更少。

## 证据：一次基于真实 Pull Request 的评测

Databricks 拿真实工作检验了这个直觉：从自家数百万行代码的生产 monorepo 里挑出约一百个 Pull Request，把事先抽走的测试恢复回去再运行，以此给每次运行判分。结果如下：

![Databricks 评测的散点图：编程 Agent 的通过率对单任务成本。红点标出 Pareto 前沿，前沿上大部分是精简的 Pi Harness，全图最高点是跑在 Pi 上的 Opus 4.8](/blog-assets/databricks-pareto.png)

_横轴是单任务成本，纵轴是通过率，红点构成 Pareto 前沿。图片来源：[Databricks](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase)。_

图的顶部和直觉正好相反。全场最高的通过率约 90%，属于跑在 [Pi](https://github.com/earendil-works/pi) 上的 Opus 4.8，而 Pi 的全部内核只有读、写、编辑加一个 shell。同一个模型跑在 Claude Code 上、开到最高档，得分略低，单任务成本却是它的两倍左右。Pareto 前沿指的是没有其他运行能在成本和通过率上同时胜过的那些运行，前沿上的点大部分是 Pi。

精简的 Harness 不只是价格上不吃亏。在榜首，它赢了。

Databricks 很谨慎，没有过度引申，我们也一样。他们明确说过，这里的教训不是某个 Harness 永远更便宜，也不是厂商自家的 Harness 更差。图本身也佐证了这份谨慎：Opus 跑在 Pi 上开 `max` 档时只有 81% 左右，明显低于同等花费下的 Claude Code。精简不是保票。但方向依然清楚，Databricks 用两句话解释了背后的机制：

> 「Pi 每轮发送的上下文少了大约三分之二。它对上下文管理得更好，工作集更紧凑，完成任务所需的运行次数也更少。」

方法上还有一个选择值得一提，因为肯这样做的评测并不多：Databricks 拒绝用模型来判分，理由是那样会「奖励听起来对，而不是真的对」。

## Harness 是一份上下文预算

模型是 API 背后的一个函数：接收系统提示词、工具定义和消息历史，返回文本和工具调用。这份契约是固定的，也是公开的，所以 Harness 只做一种决策：每一轮，模型的上下文窗口里放什么。

上下文窗口是模型在一次请求里能关注到的全部文本，长度有限。所以 Harness 做的每件事都是分配：每一轮都在替模型花一笔预算。两个 Harness 调用同一个模型，跑的不是不同的智能，而是不同的预算。在 Databricks 的数据里，花得少的那个得分更高。

## 上下文负担堆在哪里

上下文膨胀从来不是某一个糟糕决定的结果，而是四个各自说得通的决定在每一轮里不断叠加的结果。

### 工具面

每个工具的名字、描述和完整 JSON Schema，在**每一次**请求里都要付一遍。三十个工具不等于三十份便利，而是一笔常驻的税，外加一个更大的决策空间，模型容易在里面迷路。那些边际工具，通常只是在重新实现 shell 已经能做的事。

### 工具输出

装一次依赖就能吐出几千行。这些输出不是只计费一次：它们会变成历史，在之后的每一轮里重新发送。不设上限的工具输出，是把便宜任务变贵最快的途径。

### 系统提示词

冗长的行为守则，写下的是模型本来就有的判断力。告诉一个前沿模型别硬编码凭据，等于花 Token 复述它的训练数据。更糟的是，规定得太细，等于暗示你不信任模型自己推理，结果恰恰在规则没料到的情形里，模型反而犹豫。

### 每轮注入

环境快照、状态块、反复重发的配置文件，都钉在每条消息上。单个很小，却每一轮都甩不掉。

这些都不是错的想法，问题在于没人给它们标价。

## PenguinHarness 是怎么做的

这个赌注我们在那份评测出现之前就下了，它写在源码里，不在宣传页上。本节每个细节都能在仓库的 `v0.1.1` 标签下核对。

### 六个工具，没有文件工具

PenguinHarness 0.1.1 内置[六个工具](https://github.com/Prism-Shadow/penguin-harness/blob/v0.1.1/packages/docs/content/tools.zh.md)，任一会话实际只看到五个，因为两个图像工具按模型类别互斥。

| 工具 | 作用 |
| --- | --- |
| `exec_command` | 通过 `bash -lc` 执行 shell 命令，流式返回 stdout/stderr |
| `input_command` | 驱动运行中的命令：写入 stdin、发送 Ctrl-C、轮询输出 |
| `run_subagent` / `input_subagent` | 把子任务委派给子 Agent，之后轮询或追加指令 |
| `read_image` / `describe_image` | 返回图像，或交给视觉模型转成文字描述 |

0.1.1 里没有 read 工具、write 工具、edit 工具，也没有 glob 和 grep。读、写、编辑、搜索全部走 shell，因为 shell 本来就能做这些事，模型也本来就会用。一个四工具的极简内核要把三个名额（read、write 和 edit）花在文件系统上，PenguinHarness 只花一个。我们不宣称工具的绝对数量最少，Pi 的内核比我们还少一个。我们宣称的是，在 Agent 每天真正在做的事上，我们的 schema 面积最小。

### 72 行的系统提示词

0.1.1 的默认模板在替换占位符之前是 72 行、约 6,500 字符（[源码](https://github.com/Prism-Shadow/penguin-harness/blob/v0.1.1/packages/core/src/state/default-config.ts)）。内容包括角色、成功标准、约束、停止规则、文件系统布局，外加一小段建议工作流，然后就结束了。

### 输出默认设上限

每次工具调用的输出都截断在 16,000 字符，由 Environment 在一处统一执行。退出码追加在**截断窗口之外**，哪怕长输出截掉了一部分，告诉模型命令成没成功的那一行也还在。

### Skill 在用到之前只占一行

系统里没有 Skill 工具。提示词里只带每个 Skill 的名字和一行描述，需要时 Agent 再用一条普通的 shell 命令读取正文。用不到的 Skill，只占一行。

### 压缩进干净的上下文

超过 128,000 Token 后，引擎把对话摘要成一段 `<context_summary>`，然后在**全新的**上下文里继续，而不是接在一段已经臃肿的历史后面。这样一来，一个 Trace 文件恰好对应一个模型上下文。

### 干净的消息协议

用户消息上不钉任何环境元数据。模型收到的就是对话本身：用户轮、助手轮和工具结果。

## 为什么更少的上下文反而赢

「上下文越多，决策越好」这个直觉并不离谱，只是在边际上不成立，原因有两个；另外还有一个实际的理由，同样支持精简的 Harness。

第一个原因在机制上：注意力是一份固定的预算，要分给所有 Token。Self-attention 让每个 Token 都和其余所有 Token 计算权重。请求从 20K Token 涨到 60K Token，真正起决定作用的部分，比如那条实际的报错、那条实际的约束，占的份额就变小了。五条真正执行到位的规则，胜过五十条互相争抢注意力的规则；五个选对的工具，胜过三十个把搜索范围撑大的工具。

第二个原因是，冗余指令的代价不止是 Token。复述训练数据的规则不会增加能力，只会暗示模型「这里不需要你判断」。由此带来的失败不是违反规则，而是在规则没覆盖的情形里卡住。

第三个原因更实际：可移植性。后训练绑定的是**协议**，不是 Harness，所有像样的模型都在同一套 function calling 契约上训练。从模型的角度看，精简的 Harness 不过是一个恰好比较短的标准请求。这就是为什么多家厂商的模型加上开放权重的 GLM，在同一个精简封装下都表现不错，也是为什么精简的设计在你换模型之后照样好用。对一个用同一套接口接入 1000+ 模型的项目来说，可移植性是地基。

我们自己的评测结果也能用同一个道理解释。这组评测里，每个 Harness 都搭配它平时常用的模型：PenguinHarness 配 DeepSeek V4 Pro，Claude Code 配 Claude Opus 4.8，Codex 配 GPT-5.5。

- **复杂数据分析**：在我们测试的三个 Harness 里，PenguinHarness 准确率最高，为 66.67%，另外两个都是 53.33%。花费 $0.55，Claude Code 是 $38.48，账单约为后者的 1/70。
- **编程**：PenguinHarness 与 Codex 同为 71.25%，落后于 Claude Code 的 86.25%。整套题我们花了 $3.81，Codex 是 $220.08，Claude Code 是 $146.97。

我们不宣称在每个维度上都赢过前沿模型。我们宣称的是，效果的差距比价格的差距小一到两个数量级。

## 精简不该牺牲什么

这里是我们和「极简主义」分道扬镳的地方。上下文可以精简，但不能因此丢掉让一个自主进程能在真机上安全运行的那些东西。

如果连这些保障也一并砍掉，把 Harness 削薄就很容易。Pi 自己的 README 坦率写明它「不包含内置权限系统」，并建议改用容器。对个人 CLI 来说这是合理的取舍，企业却做不了这种取舍。

PenguinHarness 把安全和可观测性当作承重结构。它们在上下文里几乎不占开销，因为它们在运行时里实现，而不是写在提示词里：

- 每次工具调用恰好触发一次审批决策，审批模式有四种：`allow-all`、`deny-all`、`read-only` 和 `always-ask`。没有注入审批回调时，SDK 默认拒绝，不会有东西在无人值守时意外跑起来。
- 每个决策都以 `approval_decision` 事件写入 Trace，留作审计。
- 工具永远不向引擎抛异常。失败会变成工具输出，模型读到后据此应对。这也是精简的提示词依然安全的原因：环境把自己的错误讲得足够清楚，提示词就不必替它预判。

这些机制不给任何一轮增加 Token，每个决策也始终可以审计。

## 结论

值得记住的结论不是「简单的 Harness 更便宜」，而是在一套基于真实 Pull Request 的评测里，榜首属于最简单的 Harness，它靠的是发得更少。

如果你在构建 Agent，自查清单很短：

- 你的模型能看到多少个工具？其中多少个在重新实现 shell？
- 工具输出的硬上限是多少？
- 你的系统提示词里，有多少行在教模型预训练时就学会的事？
- 每条消息里都注入了什么？

每个答案都是一个成本项，按轮计费，贯穿整个任务。想试试 PenguinHarness，就安装它并启动 Web App：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

---

- **读实现**：[工具与审批](https://penguin.ooo/docs/tools) · [Agent 运行循环](https://penguin.ooo/docs/agent-loop) · [技能与插件](https://penguin.ooo/docs/skills)
- **来找我们讨论**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**：[Databricks — Benchmarking Coding Agents on Databricks' Multi-Million Line Codebase](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase) · [Pi (earendil-works/pi)](https://github.com/earendil-works/pi) · [SaladDay《Less is More》](https://x.com/Salad95238547/status/2079508549382644194)
