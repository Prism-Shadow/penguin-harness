---
title: "Simple Harness Is All You Need：精简的 Harness 就够了"
date: 2026-07-22
category: practice
excerpt: Databricks 拿自家百万行代码库里的真实 PR，评测了多个 coding agent harness。全场最高分不属于功能最全的那个 harness，而属于最简单的那个，成本还只有一半左右。本文讲清楚上下文纪律为什么胜过功能数量，以及 PenguinHarness 怎么把这个判断写进了代码。
---

按直觉想，功能丰富的 Agent harness 应该赢过精简的那个：工具更多、上下文更全、脚手架更厚，决策自然更好。整个品类就是建立在这个直觉上的。

Databricks 拿真实工作检验了它——从自家百万行的生产级 monorepo 里挑出约一百个 Pull Request，把此前抽走的测试恢复回去跑一遍来判分。结果是这样的：

![Databricks 的 Pareto 图：任务通过率对单任务成本。前沿几乎被精简的 Pi harness 占满，全图最高分是跑在 Pi 上的 Opus 4.8](/blog-assets/databricks-pareto.png)

_横轴是单任务成本，纵轴是整体通过率，红点构成 Pareto 前沿。图片来源：[Databricks](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase)。_

请仔细看这张图的顶部，因为那里的结论和直觉完全相反。**全场最高的通过率，约 90%，属于跑在 [Pi](https://github.com/earendil-works/pi) 上的 Opus 4.8**——而 Pi 的整个内核只有读、写、编辑，加一个 shell。同一个模型跑在 Claude Code 上、开到最高档，分数略低，单任务成本却是它的两倍左右。而 Pareto 前沿上的点，大部分都是 Pi。

精简的那个 harness 不只是在价格上守住了阵地。**在榜首，它赢了。**

Databricks 自己很谨慎，我们也该同样谨慎：他们明确说过，这里的教训**不是**某个 harness 永远更便宜，也**不是**厂商自家的 harness 更差。这张图本身就佐证了这份谨慎——Opus 跑在 Pi 上开 `max` 档时只有 81% 左右，明显低于同等花费下的 Claude Code。**精简不是保票。** 但方向不会看错，而他们对机制的解释只有一句话：

> Pi 每轮发送的上下文大约少三倍。它把工作集管得更紧，用更少的轮次完成了任务。

还有一个细节值得一提，因为这么做的人比应该有的少得多：他们拒绝用模型来判分，理由是那样会奖励"听起来对"，而不是"真的对"。

## 一、Harness 的本质是一份上下文预算

模型是 API 背后的一个函数。它接收 system prompt、工具定义、消息历史，返回文本和工具调用。这份契约是固定的，也是公开的。**除此之外的一切——所有决定"这个请求里放什么"的软件——就是 harness。**

也就是说，harness 从头到尾只做一类决策：**有限的上下文窗口，究竟被什么占着**。它不是一张功能清单，而是一份替模型花出去的预算，每一轮都要重花一次。

换了这个视角，那张图立刻就讲得通了：两个 harness 调的是同一个模型，跑的不是不同的智能，而是不同的预算——**而花得更少的那个，分数更高。**

## 二、重量到底堆在哪里

上下文膨胀从来不是一个糟糕的决定，而是四个各自都说得通的决定，在每一轮里复利叠加。

**工具面。** 每个工具在**每一次**请求里都要付出名字、描述和完整 JSON Schema 的代价。三十个工具不等于三十份便利，而是一笔常驻的税，外加一个更大的、够模型迷路的决策空间。而那些边际工具，往往正是在重新实现 shell 早就有的能力。

**工具输出。** 一次依赖安装吐出几千行。这些输出不是只计费一次，它们会变成历史，在之后的每一轮里被重新发送。**不设上限的工具输出，是把便宜任务变贵最快的途径。**

**System prompt。** 冗长的行为守则，编码的是模型本来就有的判断力。告诉一个前沿模型别硬编码密钥，等于花 token 复述它的训练数据。更微妙的是，规定得太细本身就在暗示模型的判断不被信任，于是碰上规则没覆盖的情形，它反而更容易犹豫——而那恰恰是最需要它自己拿主意的时候。

**每轮注入。** 环境快照、状态块、被反复重发的配置文件，统统钉在每条消息上。单看微不足道，结构上却是永久的。

这些都不是错的想法，只是**没被定价**的想法。

## 三、PenguinHarness 是怎么做的

在这份评测出现之前，我们就下了这个赌注，而且它写在源码里，不在宣传页上。下面每个数字都能在仓库里核对。

**六个工具，而且完全没有文件工具。** PenguinHarness 内置[六个工具](https://penguin.ooo/docs/tools)，任一会话实际只看到五个——两个图像工具按模型类别互斥。

| 工具 | 作用 |
| --- | --- |
| `exec_command` | 通过 `bash -lc` 执行 shell 命令，流式返回 stdout/stderr |
| `input_command` | 驱动运行中的命令：写 stdin、发送 Ctrl-C、轮询输出 |
| `run_subagent` / `input_subagent` | 把子任务委派给子 Agent，之后轮询或追加指令 |
| `read_image` / `describe_image` | 返回图像，或交给视觉模型转成文字描述 |

没有 read 工具，没有 write 工具，没有 edit 工具，没有 glob，也没有 grep。读、写、编辑、搜索全部走 shell，因为 shell 本来就能做这些，模型本来就会用它。当一个四工具的最小内核把 read、write、edit 三个名额花在文件系统上时，**我们只花一个**。我们不宣称绝对工具数最少（论内核，Pi 比我们还紧一个），我们宣称的是：**在"Agent 每天真正在做的事"上，我们的 schema 面积最小。**

**72 行的 System Prompt。** 默认模板在变量替换前是 72 行、约 6,600 字符（[源码](https://github.com/Prism-Shadow/penguin-harness/blob/main/packages/core/src/state/default-config.ts)）。角色、成功标准、约束、停止规则、文件系统布局，外加一小段建议工作流，然后就结束了。

**输出上限是默认行为。** 每次工具调用截断在 16,000 字符，由 Environment 统一执行。退出码被追加在**截断窗口之外**，所以哪怕输出中段被砍掉，那条告诉模型"命令到底成没成"的信息依然还在。

**用不到就不花钱的 Skills。** 系统里没有 skill 工具。Prompt 只带上每个 skill 的名字和一行描述，正文等到需要时用一条普通 shell 命令读进来。这次用不到的 skill，只花你一行的代价。

**压缩之后是干净的上下文。** 超过 128,000 tokens 后，引擎把历史摘要成 `<context_summary>`，在一个**全新的**上下文里继续，而不是接在一段已经臃肿的历史后面——于是一个 trace 文件恰好对应一个模型上下文。

**干净的消息协议。** 不把环境元信息钉在用户消息上。模型收到的就是对话本身：用户轮、助手轮、工具结果。

## 四、为什么"更少"反而赢

"上下文越多，决策越好"这个直觉并不蠢，只是在边际上不成立，原因有两个。

**注意力是固定预算，而且会被摊薄。** Self-attention 让每个 token 都要和其余所有 token 算权重。当请求从 20K tokens 涨到 60K，真正起决定作用的那部分——那条实际的报错、用户实际的约束——占的份额就变小了。**五条被执行到位的规则，胜过五十条互相抢注意力的规则；五个被正确选中的工具，胜过三十个把搜索空间撑大的工具。**

**冗余指令的代价不止是 token。** 复述训练数据的规则不增加能力，只增加"这里不需要你判断"的暗示。它的失效模式不是模型违反规则，而是**模型在规则没覆盖的场景下卡住**。

还有第三个更实际的理由：**可移植性**。后训练绑定的是**协议**，不是 harness。所有严肃的模型都在同一套 function calling 契约上训练。从模型的角度看，一个精简的 harness 不过是一个恰好比较短的标准请求——这就解释了为什么多家厂商的模型、加上开放权重的 GLM，在同一个精简 harness 下都表现不错，也说明精简的设计最有可能在你换模型之后依然好用。对于一个价值主张是"一套接口接 1000+ 模型"的项目，这是地基。

我们自己的数字落在那个位置，也是同一个道理。复杂数据分析上，PenguinHarness 搭配 DeepSeek V4 Pro 拿到了三者中最高的准确率（66.67%，两个对手各 53.33%），花费 **$0.55**，Claude Code 是 **$38.48**，账单约为其 1/70。编程题上，我们和 Codex 以 71.25% 打平，落后于 Claude Code 的 86.25%，但整套题我们花了 **$3.81**，它们分别是 **$220.08** 和 **$146.97**。我们不宣称在每个维度上都赢过前沿模型，我们宣称的是：**效果的差距，比价格的差距小一到两个数量级。**

## 五、精简不该牺牲什么

这里是我们和"极简主义"分道扬镳的地方。

要把 harness 削薄其实很容易，前提是你连"让一个自主进程敢在真机上跑"的那部分也一并砍掉。Pi 的 README 就坦率写明它**不包含内置权限系统**，并建议改用容器隔离。对个人 CLI 来说这是合理取舍，对企业不是。

我们把安全和可观测当成承重结构，而它们在上下文里几乎不花钱，恰恰因为**它们活在运行时，不活在 prompt 里**：

- **每次工具调用恰好触发一次审批决策**，四种模式：全部允许、全部拒绝、只读放行、每次询问。SDK 在没有注入审批回调时**默认拒绝**，不会有东西在无人值守时意外跑起来；
- **每个决策都以 `approval_decision` 事件写入 Trace**，形成完整审计记录；
- **工具永远不向引擎抛异常**。失败会收敛成模型读得懂、也能据此反应的工具输出——这也正是精简 prompt 依然安全的原因：**环境把自己的错误讲清楚了，prompt 就不必去替它预判。**

每轮零额外 token，同时完全可审计。**上下文窗口里讲纪律，运行时里讲严谨。**

## 六、结论

值得记住的结论不是"精简的 harness 更便宜"，而是：在一套基于真实 Pull Request 的评测里，**最简单的那个 harness 拿到了最好的成绩**——靠的是发得更少。

如果你在构建 Agent，自检清单很短：

- 你的模型看到多少个工具？其中多少个在重新实现 shell？
- 你的工具输出硬上限是多少？
- 你的 system prompt 里，有多少行在教模型它预训练时就学会的事？
- 每条消息里到底被注入了什么？

每一个答案，都是一个**按轮计费、贯穿整个任务生命周期**的成本项。

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

---

- **读实现**：[工具与审批](https://penguin.ooo/docs/tools) · [Agent Loop](https://penguin.ooo/docs/agent-loop) · [Skills](https://penguin.ooo/docs/skills)
- **来讨论**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**：[Databricks — Benchmarking Coding Agents on Databricks' Multi-Million Line Codebase](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase) · [Pi (earendil-works/pi)](https://github.com/earendil-works/pi) · [SaladDay《Less is More》](https://x.com/Salad95238547/status/2079508549382644194)
