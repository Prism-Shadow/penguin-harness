---
title: "选一个算法，让 Agent 在 Benchmark 上自己进化"
date: 2026-10-13
category: practice
excerpt: "从 PenguinHarness 0.2.15 的五个自进化算法里选一个，用内置的 GDPevo Benchmark 跑你的 Agent，到评估中心看结果，再决定保留还是回滚新版本。"
---

PenguinHarness 0.2.15 把五个自进化算法做成了插件，也就是 RSI 工具包，并给每个新建 Project 配了七个内置 Benchmark 供它们运行。RSI 工具包改的是 Agent 的 Harness，也就是它的提示词和 Skill，模型保持不动，每一处改动都在 Benchmark 上度量效果。

本教程带你在 GDPevo Train 上对自己的 Agent 跑一轮优化，到评估中心看结果，再决定要不要保留新版本。

## 准备工作

- PenguinHarness 0.2.15，以及用它创建的 Project。内置 Benchmark 是创建 Project 时写入的；如果是更早的 Project，打开**新建对话**，在**评测与优化智能体**下面选**导入 GDPevo 评测集**。
- 一个模型，API 密钥已经保存在**模型库**页面。
- 在**智能体**页面有一个你自己的 Agent。截图里用的这个叫 Business Analyst（`biz_analyst`）。
- PenguinHarness 所在的机器上装有 Docker（含 Compose v2）和 [uv](https://docs.astral.sh/uv/)，并且能访问 GitHub、Docker Hub、nodejs.org、npm registry 和你的模型服务商。内置 Benchmark 的每道题目都作为 [Harbor](https://github.com/harbor-framework/harbor) task 在 Docker 里运行。

## 第 1 步：选一个算法

打开**插件市场**。**Agent 自进化**分类下就是这五个工具包：

- `default-rsi-toolkit`：试跑、反思、提升。每轮只提一个假设、做一处改动；分数严格上升才保留版本。
- `opro-rsi-toolkit`（[OPRO](https://arxiv.org/abs/2309.03409)）：从已评分指令的历史里提出新的指令。
- `ape-rsi-toolkit`（[APE](https://arxiv.org/abs/2211.01910)）：一次性从输入/输出示例中归纳出候选指令。
- `ace-rsi-toolkit`（[ACE](https://arxiv.org/abs/2510.04618)）：Reflector 阅读训练 Trace，Curator 把经验整理进一份操作手册（playbook）。
- `awm-rsi-toolkit`（[AWM](https://arxiv.org/abs/2409.07429)）：从成功轨迹中归纳出可复用的操作流程，写入 Agent 的记忆。

![插件市场页面上的 Agent 自进化分类，五个 RSI 工具包都在里面](/blog-assets/penguinharness-0-2-14-rsi-plugins-zh.png)

工具包要装在运行它的 Agent 上，而不是要优化的那个 Agent 上。默认由 General Agent 跑，0.2.15 创建的 Project 里已经装齐了五个。旧 Project 里没装，或者想换别的 Agent 来跑，就在工具包的卡片上装到那个 Agent。本教程用的是默认工具包；其余四个在第 4 步里按同样的方式选。

## 第 2 步：打开 GDPevo Train

打开**评估中心**。新建的 Project 里会列出 PenguinHarness Benchmark Sec A 到 Sec E，以及 GDPevo 的两个集合。GDPevo 本身就是为自进化设计的：先在 GDPevo Train 上优化，再用 GDPevo Test 检验，它是同样六个公司环境里另外留出的 30 道题目。

![评估中心，列出内置 Benchmark](/blog-assets/penguinharness-0-2-14-benchmarks-zh.png)

## 第 3 步：先跑一个基线

默认工具包会拿每个候选版本跟 Agent 上一次的分数比，所以得先有个基线。另外四个工具包自己会测基线，用它们就跳过这一步。

1. 在 GDPevo Train 上选**使用**。对话框打开时停在**评估**。
2. 在**被测 Agent**里选你的 Agent。
3. 在**评估会话使用的模型**里选测试用的模型。你的 Agent 就跑在这个模型上，思考等级沿用 Agent 自己配置的。
4. 选**在新对话中编辑**，然后发送。

每道题是一次 Harbor trial，四个同时跑，一个 trial 从几分钟到一小时左右不等。

## 第 4 步：启动优化

1. 再选一次**使用**，打开**优化**标签页。
2. 在**方法**里选工具包。这个列表每次打开对话框都会从插件库重新读取。
3. 在**被测 Agent**里选你的 Agent。用默认工具包时，这里会显示该 Agent 当前的基线和目标分数。
4. **执行优化的智能体**保持 General Agent 不变，或者选一个装有该方法 Skill 的其他 Agent。
5. 默认工具包要设置**最多轮数**（默认 3）和**目标分数**（基线向上取整再加 10）。其他工具包会隐藏这两项，按各自论文的默认值运行，只是把预算压缩到冒烟测试的量级，除非**优化重点**另有指定。
6. 选**在新对话中编辑**，读一遍提示词，再发送。

![优化标签页，方法列表处于展开状态](/blog-assets/rsi-toolkits-method-zh.png)

## 第 5 步：看一轮怎么跑

默认工具包的每一轮都会读取分数和 Trace，提出一个可证伪的假设，把当前版本快照到 `snapshots/v<N>.tar.gz`，然后在下一个版本号下做一处改动。接着为每道题的每次运行各启动一个评估子 Agent，模型和思考等级与基线相同。总分严格更高才保留这个版本，否则撤回这处改动。

![一轮优化：改动、全部 30 道题的评估和前后分数](/blog-assets/rsi-toolkits-optimize-chat-zh.png)

## 第 6 步：看结果

打开这个 Benchmark 的页面。**分数随时间变化**会按 Agent、模型和思考等级各画一条线。保留下来的版本就是那条线上的一个新点，版本号显示在悬停文本和**版本**列里。不同工具包在同一 Agent、模型和思考等级上的运行共用一条线，靠每个点的版本号区分。

![GDPevo Train 上三个 Agent 的分数随时间变化，以及评估明细表](/blog-assets/penguinharness-0-2-14-benchmark-detail-zh.png)

在**评估明细**里选中一行，可以看到每道题和每次运行。以 Harbor trial 形式记录的运行带一个按钮，点击可以复制 trial 的名字；trial 的文件保留在该 Benchmark 的 `.jobs/` 目录里。

![一次评估的逐题分数](/blog-assets/rsi-toolkits-evaluation-zh.png)

## 第 7 步：保留还是回滚

- **保留**。运行结束时的版本已经是 Agent 的当前版本。想知道提升在 Agent 没见过的题目上是否站得住，就用同一个模型在 GDPevo Test 上再评估一次（第 3 步）。
- **回滚**。在**智能体**页面打开这个 Agent，在**Agent State**下选**导入快照**。选择该 Agent 目录里的 `snapshots/v<N>.tar.gz`；如果 PenguinHarness 跑在别的机器上，先把文件复制到你自己的电脑。只有 Project 的所有者能导入。每次导入都会要求确认，快照不比当前版本新时还会再确认一次。导入前会先给当前版本做一份快照，Vault 保留不动。

## 限制

- 在 GDPevo Train 上评估一个候选版本等于 30 个 Harbor trial，每道题运行一次，每个 trial 都消耗模型 Token。
- trial 默认四个同时跑，可以另行指定上限（比如写在评估的**说明**里），但最多八个。
- 跑 GDPevo 题目期间，Agent 只能访问模型服务商的 API 主机，因为 GDPevo 的答案是公开的。
- 0.2.15 之前创建的 Agent 没有装 OPRO、APE、ACE 和 AWM 工具包，需要你手动安装；新建 Agent 则只有创建时勾选的那些插件。

对话框里各字段的说明见[评估中心文档](https://penguin.ooo/docs/evaluation-center)。每个算法怎么运行，见 [RSI 工具包](https://penguin.ooo/docs/self-improvement#rsi-工具包)。
