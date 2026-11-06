---
title: "用 PenguinHarness 组织四种 Harness 的对比实验"
date: 2026-11-05
category: practice
author: "Zhihao Liu (Prism Shadow AI)"
excerpt: "固定底层模型与思考强度，在五个评测集、共 50 道题上对 PenguinHarness、DSH、Pi、Codex 四种 Harness 开展三轮对比实验，拆解任务通过率、多轮稳定性与资源开销差异，并说明如何通过 PenguinHarness 组织和复现这套评测。"
---

平时用 Agent 写代码、查数据，每当任务失败时，我们大多会把原因归结给大模型：“这模型还是不够聪明。”但真是模型的问题吗？如果把模型固定，只换掉外层的 Harness，Agent 的表现到底能差多少？为了拿到真实数据，我们使用 PenguinHarness 创建了一个专门组织实验的 Agent，让它调用 Harbor 容器环境，对 **DSH、PenguinHarness、Pi、Codex** 四种 Harness 发起测试。50 道题，每种 Harness 连续跑满 3 轮，一共 **600 次真实作答**。今天我们就来聊聊，这场实验是怎么在 PenguinHarness 里跑起来的，以及分析这 600 条实验记录后，我们看到的四个有趣现象。

## 1. Benchmark 构成与实验规则

要看清 Harness 之间的真实差距，首先得把其它变量全部固定。我们在四组实验里统一使用模型 **DeepSeek-V4.1-Flash-1017**，思考强度全部拉满到 **max**，由 Harbor 0.23.0 在独立 Docker 容器里把 50 道题各跑 3 轮：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/03-experiment-design.png" width="2880" height="1730" alt="图 1｜四种 Harness 在 50 道固定任务上的三轮实验设计" /><figcaption>图 1｜四种 Harness 在 50 道固定任务上的三轮实验设计</figcaption></figure>

这 50 道题可不是随便挑的。我们从五个公开基准的 864 道候选题出发，花了两轮实测才把题库敲定下来，完整筛选记录见仓库 [SELECTION.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/SELECTION.zh.md)：

1. **第一轮剔除重型环境题**：剔除所有依赖 GPU、多容器编排、内存超过 8 GB 或运行期需要下载大权重文件的题目，保证一台普通纯 CPU 机器就能跑完全程，且单轮 50 题的 API 预算不超过 $20。
2. **第二轮实际试跑，去掉太简单、太难或环境不稳的题**：先把剩下的题跑一遍，去掉四家全对、四家全错或者容器偶发报错的题目，最后留下真正能试出差距的 50 道题，分成 A 到 E 五个子集，每个子集 10 道题：

| 子集 | 上游来源 | 考察内容 | 单题时限 | 请求上限 |
| --- | --- | --- | --- | --- |
| Sec A | Data Analysis Bench | 跨多源文档、表格与数据库清洗计算并输出结论 | 15m | 100 |
| Sec B | DeepSWE v1.1 | 在真实开源仓库中定位缺陷、编写补丁并通过回归测试 | 30m | 250 |
| Sec C | AutomationBench | 调用业务系统与本地服务接口，完成多步骤自动化流程 | 10m | 50 |
| Sec D | Terminal-Bench-Science 0.1 | 在 Linux 终端完成天体物理、生物信息等科学计算建模 | 40m | 320 |
| Sec E | Terminal-Bench 4.0 | 在真实终端完成系统排障、存储引擎修复与编译调试 | 25m | 200 |

## 2. 用 Penguin 四步发起实验

跑 600 次容器评测涉及不少繁琐环节：配网络、打离线包、控并发、查异常重跑，最后还要汇总 20 组实验的 YAML 报表。但我们不需要手敲一堆终端脚本，直接在 PenguinHarness 界面里创建一个专门的 Agent，让它接管全流程实验即可。

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/04-penguin-reproduction-flow.png" width="2880" height="1740" alt="图 2｜用 PenguinHarness 组织四种被测 Harness 的复现流程" /><figcaption>图 2｜用 PenguinHarness 组织四种被测 Harness 的复现流程</figcaption></figure>

在 PenguinHarness 的 Web 界面里，从零发起整套实验只需要四步：

**第一步：在「模型配置」中接入被测模型**

打开左侧的**模型配置**页面，在 DeepSeek 分组下点开 DeepSeek V4.1 Flash 配置弹窗，填入 API key 与接口地址 https://api.deepseek.com，点击上方的**设为默认模型**并保存：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_01_model_config.png" width="2372" height="1544" alt="在模型配置页面接入 DeepSeek V4.1 Flash 并设为默认模型" /><figcaption>在模型配置页面接入 DeepSeek V4.1 Flash 并设为默认模型</figcaption></figure>

**第二步：创建专门组织评测的「Harness评测」Agent**

切换到 **Agents** 页面，点击右上角的**手动创建**，在弹窗里填好名称 **Harness评测** 与 Agent ID harness_evaluation，点击右下角**创建**：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_02_create_agent.png" width="1776" height="1524" alt="手动创建 Harness评测 Agent" /><figcaption>手动创建 Harness评测 Agent</figcaption></figure>

创建完成后，在 Agent 列表中直接点击 **Harness评测** 右侧的 **+ 新建对话**：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_03_agents_list.png" width="1774" height="834" alt="在 Agents 列表中点击新建对话" /><figcaption>在 Agents 列表中点击新建对话</figcaption></figure>

**第三步：选定「最高」思考强度，把实验 Prompt 交给 Agent**

进入新建对话页面后，确认左下角已选中 **Harness评测** 与工作目录，在输入框右下角将模型设为 DeepSeek V4.1 Flash、思考强度设为**最高**：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/ui_04_chat_box.png" width="1834" height="836" alt="在新建对话界面选定 Harness评测、工作目录、最高思考强度与被测模型" /><figcaption>在新建对话界面选定 Harness评测、工作目录、最高思考强度与被测模型</figcaption></figure>

接着将下面这段完整的实验 Prompt 复制到输入框并发送：

```text
请帮我组织并复现四种 Harness 的三轮对比实验，具体要求如下：

1. 实验仓库与快照
- 克隆仓库 https://github.com/Prism-Shadow/penguin-harness-benchmark.git 并检出快照 6ad65ea054fe8035c1c48724dbb5626d699f6cb2。
- 读取 README.zh.md、SELECTION.zh.md、data/README.md 与 agents/README.md，核对 50 道题的任务目录与子集配置。

2. 被测对象、统一模型与思考强度
- 运行器统一使用 Harbor 0.23.0。
- 四种被测 Harness 与版本分别为：DSH 0.2.1-rc.2、PenguinHarness 0.2.17、Pi 1.4.0、Codex 0.162.1。
- 模型统一使用 deepseek/DeepSeek-V4.1-Flash-1017，并核实四种被测 Harness 均按各自适配器的实际参数启用 max 思考强度。

3. 五个子集、运行轮次与单题预算
- 对 Sec A 至 Sec E 五个子集各 10 道题、共 50 道题分别独立运行 3 轮，每种 Harness 运行 150 次，合计 600 次作答：
  - Sec A：data/penguinharness-benchmark-sec-a，10 题，单题时限 15m，请求上限 100，允许公网并复用共享网络 penguin-bench
  - Sec B：data/penguinharness-benchmark-sec-b，10 题，单题时限 30m，请求上限 250，禁用公网，仅通过 --allow-agent-host 放行模型 API 主机
  - Sec C：data/penguinharness-benchmark-sec-c，10 题，单题时限 10m，请求上限 50，允许公网并复用共享网络 penguin-bench
  - Sec D：data/penguinharness-benchmark-sec-d，10 题，单题时限 40m，请求上限 320，允许公网并复用共享网络 penguin-bench
  - Sec E：data/penguinharness-benchmark-sec-e，10 题，单题时限 25m，请求上限 200，允许公网并复用共享网络 penguin-bench

4. 环境与适配器准备、单题验证与批量运行
- 创建 Docker 共享网络 penguin-bench 并构建离线运行包。仓库 agents/ 目录内置了 penguin_agent:PenguinAgent 适配器；复现 DSH、Pi、Codex 前，请先核实并准备好符合 Harbor InstalledAgent 接口的对应适配器与离线运行包。
- 先以单并发运行 data/penguinharness-benchmark-sec-e/tasks 中的 embedding-drift-monitor 完成单题验证，确认离线包解压、模型调用、产物落盘和独立验证器判分正常。
- 单题验证通过后，按单机并发度不超过 4 依次运行四组 Harness 在五个子集上的三轮实验。

5. 异常核查与结果汇总
- 每轮结束后按 tools/measure/reruns.py 核查并补跑未实质启动的试次，输出各组各子集的 meta_info.yaml、test/attempt-1..3.yaml 与 test/summary.yaml，并汇总四组的得分、逐题通过频次与资源开销对比表。
```

**第四步：自动运行并生成汇总报表**

发出指令后，Harness评测 Agent 会自己下载代码库、先跑一道题验证环境，接着批量跑完三轮测试，并在跑完后自动排查没启动成功的容器、生成四组 Harness 的完整成绩单与开销对比表。本文分析的 600 次完整作答记录，均已归档在仓库 experiments/harness-comparison/ 目录下。

## 3. 单道题怎么跑完并判分？

为了防止不同 Harness 在环境上占便宜或吃亏，我们在容器外立了三条规矩：

1. **环境离线挂载**：四种 Harness 的运行包全部提前打成离线压缩包，容器启动时直接挂载到独立目录解压，绝不触碰题目容器自带的 Python 或 Node 环境。
2. **开源修 Bug 题断网隔离**：由于 Sec B 的题目来自真实开源仓库的历史缺陷，为了防止 Agent 直接上网搜到原仓库现成的修复 PR 或 Issue，Sec B 容器全程断开公网，仅白名单放行模型 API 域名。
3. **容器没启动成功才补跑，做错或超时绝不重来**：每轮跑完后自动检查一遍。只有当容器本身没拉起来、Agent 连第一句请求都没发出去时，才算环境故障并重新跑；只要 Agent 已经开始做题，不管中途报错还是超时，成绩都直接算数，绝不重跑刷分。

那么，一道题在容器里是怎么跑完并打分的？如图 3 所示，最关键的设计是**“做题”和“判卷”完全分开**：Agent 在容器的 /app 目录里读代码、改文件、调工具，做完退出后，判卷脚本才进到 /app 目录跑验收测试，只看最终改出来的结果对不对——测试全过得 100 分，有一个不过就是 0 分：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/05-trial-execution.png" width="2880" height="1570" alt="图 3｜单道题目的容器内执行与独立判分流程" /><figcaption>图 3｜单道题目的容器内执行与独立判分流程</figcaption></figure>

举个实际的例子。Sec E 的第 8 题 [embedding-drift-monitor](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/data/penguinharness-benchmark-sec-e/tasks/embedding-drift-monitor) 是一道修 Bug 题：容器里提前放好了一套有缺陷的监测程序，里面存在多处逻辑和计算 Bug。四种 Harness 都要在 25 分钟、200 次请求内自己读代码找出并修好这些问题，交卷后再由判卷脚本跑 pytest 验收。结果很有意思：Codex 三轮都觉得自己改完了、主动交卷，但改出来的代码没跑过 pytest，三轮全拿 0 分；而 DSH 和 PenguinHarness 三轮改出的代码全部通过测试，稳稳拿到三个 100 分。

## 4. 得分与消耗怎么算？

600 次测试全部跑完后，我们从得分和资源消耗两方面汇总结果。**首先是得分**：每种 Harness 跑满三轮一共作答 150 次，每多做对 1 次，三轮平均总分就会涨 **0.67** 分，具体算法如图 4 所示：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/06-statistics-method.png" width="2880" height="2392" alt="图 4｜总体均分与样本标准差的计算" /><figcaption>图 4｜总体均分与样本标准差的计算</figcaption></figure>

**其次是资源消耗**：我们将每轮跑完 50 道题的 API 费用、Agent 累计运行时间与 Token 用量分别累加，再跨三轮取平均值；其中 Token 用量按计费方式拆分为**非缓存输入、缓存读取、模型输出**三类分别统计。

## 5. 实测中的四个有趣现象

首先看整体成绩：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/01-overall-bars.png" width="2880" height="1140" alt="图 5｜四种 Harness 的三轮总体得分对比" /><figcaption>图 5｜四种 Harness 的三轮总体得分对比</figcaption></figure>

光看这张总榜，前两名 DSH 和 PenguinHarness 只差了 0.67 分，150 次作答里也就是 58 次通过和 57 次通过，只差了 1 次，看起来好像大差不差。但把总分拆到五个子集、拆到每道题的通过次数和资源消耗上，四家的差距一下就出来了。

**现象一：PenguinHarness 最擅长解决软件工程题**

把总分拆到 A 至 E 五个子集后，四款 Harness 各自擅长什么题型就看得很清楚了：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/02-subset-bars.png" width="2880" height="3260" alt="图 6｜四种 Harness 在五个子集上的得分对比" /><figcaption>图 6｜四种 Harness 在五个子集上的得分对比</figcaption></figure>

如图 6 所示，PenguinHarness 在断网修 Bug 的 **Sec B 软件工程**子集上优势最为突出，拿到全场最高的 **70.00 分**；并与 DSH 在 **Sec A 数据分析**上同拿 70.00 分并列第一，DSH 在 **Sec C 自动化流程**上领先，Pi 则在 **Sec E 终端排障**上领先——**同一颗模型，换一套 Harness，擅长的题型就变了**。更有意思的是，把四家三轮的成绩合在一起看，这 50 道题里其实有 31 道题这颗模型是会做的，占了 62%，只有 19 道题四家全都没做出来。但在这 31 道会做的题里，四家都能拿下的只有 17 道。剩下的 14 道题全看你用哪套 Harness：有 9 道题只有两三家能做出来，更有 5 道题只有唯一一家能跑通。

**简而言之，当你的 Agent 搞不定一个任务时，很大概率不是底层模型不会做，而是当前 Harness 的工具设计和上下文反馈，没能帮模型把原本具备的能力释放出来。**

**现象二：看 Pass@3，PenguinHarness 与 DSH 并列第一，拉低总分的原因是发挥不稳定**

既然单家 Harness 单轮平均只能做对 15 到 19.3 道题，那如果给它三次机会呢？我们统计了每道题在三轮测试中的通过频次：三轮里至少做对一次，就是图 7 里的 **Pass@3**，说明这道题它能做出来；三轮全部做对，才算每次都能稳定拿分。

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/09-pass-frequency.png" width="2880" height="1330" alt="图 7｜50 道题在三轮测试中的通过频次分布" /><figcaption>图 7｜50 道题在三轮测试中的通过频次分布</figcaption></figure>

从图 7 可以直接看出，DSH 与 PenguinHarness 在三轮内都解出了 **25 道题**，并列全场第一。但把 PenguinHarness 解出的这 25 道题拆开看，三次都能稳稳做对的只有 **10 道题**，另外有全场最多的 **12 道题**明明做对了两次、却偏偏失手一次——假如能把这 12 道题里做错的那一次做对、同时其他题不丢分，不用多攻克任何一道新难题，光在稳定性上就有 **8 分**的提升空间。这种情况在 **Sec B 软件工程**子集上尤为极端：这 10 道修 Bug 题目在三轮内其实**全部被 DSH 和 PenguinHarness 修好过**，两家的子集 Pass@3 都达到了 **100%**，但真正能三次全过的分别只有 2 题和 3 题。

**这也说明了另一件事：跑三次能对一次，说明这道题它能做出来；但真正决定 Agent 实际好不好用的，是 Harness 能不能在交卷前多做一步自检，把“三轮对两轮”变成“三次跑三次全过”。**

**现象三：三轮总分一模一样，做对的题却换了——看评测结果不能只看总分**

看子集汇总表时，我们注意到一个奇怪的现象：全部 20 组子集实验里，有 **4 组非零分实验三轮跑出来的总分一模一样，标准差都是 0.00**。这代表 Agent 在每道题上的表现都完全稳定吗？我们把 PenguinHarness 在 Sec E 的逐题成绩单拉了出来——它三轮都是 20 分：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/07-task-stability.png" width="2880" height="1560" alt="图 8｜PenguinHarness 在 Sec E 三轮测试中的逐题通过记录" /><figcaption>图 8｜PenguinHarness 在 Sec E 三轮测试中的逐题通过记录</figcaption></figure>

如图 8 所示，虽然每轮都拿 20 分，但真正三轮全做对的只有 CASE-008 一道题；另外 10 分，第 1 轮拿在 CASE-010 上，第 2、3 轮却拿在了 CASE-004 上。再去查另外三组“三轮同分”的实验，只有 DSH 在 Sec A 的 70 分是实打实的同 7 道题三轮全过，**剩下两组也都是靠“这轮做对 A 题、下轮做对 B 题”刚好凑出了同样的总分**：

1. **Codex 在 Sec A 三轮都是 60 分**：第 2 轮靠 CASE-002 和 CASE-007 的一增一减，刚好凑出同样的 60 分。
2. **Codex 在 Sec D 三轮都是 10 分**：最夸张的一组——它甚至**没有任何一道题三轮全过**，第 1 轮做对的是 CASE-010 小行星定轨，第 2、3 轮做对的却换成了 CASE-003 脑成像配准，跨轮次拼出了三个 10 分。

**这给日常做 Agent 迭代敲了一记警钟：总分没变，不等于能力没变；单轮涨分，也不等于真变强了。**如果每次改完提示词或工具链只跑一轮、或者只盯着总分涨跌，你根本分不清一次改动到底是真提分，还是“修好了 A 题、弄坏了 B 题”，甚至把随机波动当成了优化成果。

**现象四：多花 Token 不一定能提分——修 Bug** **的题越跑分越高，科学计算题却在超时白跑**

最后我们来看这 600 次测试的资源消耗。跑完一整轮 50 道题，四家 Harness 的费用、耗时与三类 Token 用量从低到高对比如图 9、图 10 所示：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/08-resource-comparison.png" width="2880" height="1640" alt="图 9｜单轮 50 题的 API 费用与累计运行时间对比" /><figcaption>图 9｜单轮 50 题的 API 费用与累计运行时间对比</figcaption></figure>

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/08b-token-comparison.png" width="2880" height="2260" alt="图 10｜单轮 50 题的三类 Token 用量对比" /><figcaption>图 10｜单轮 50 题的三类 Token 用量对比</figcaption></figure>

由于四家都有约 99% 的输入命中了缓存，API 费用高低主要由模型的输出 Token 决定。那么，**让 Agent 多输出 Token、多花时间尝试，到底能不能换来更高分？**拆到具体题型里看，结果完全相反：

1. **在 Sec B 软件工程题上，多花 Token 确实换来了高分**：因为修 Bug 的题可以边改代码边跑测试，Agent 看得到报错就能接着改。PenguinHarness 在这 10 道题上单轮输出了 1.45 M Token、花费 $1.48，靠更充分的测试和修改拿下了全场最高的 **70.00 分**；而输出与花费依次减少的 DSH、Pi 与 Codex，得分也跟着往下掉。
2. **在 Sec D 科学计算题上，多花的时间全在超时白跑**：这 10 道题耗掉了各家整轮 **34% 到 53% 的运行时间**，单轮就要跑上 4 到 5 个多小时，最后四家得分却全在 10 分及以下。在保留了逐题耗时的 DSH 和 Codex 记录里，30 次尝试分别有 10 次和 12 次一直拖过 35 分钟、贴着 40 分钟超时线退出。因为这类题中间往往缺少直接的对错验证，Agent 一旦思路走偏又不懂及时停下，就容易一直白跑到超时。

**说到底，“多花 Token 能不能换来高分”，很大程度上取决于任务环境有没有明确的反馈信号。**像修 Bug 这类能随时跑测试、看报错的任务，让 Agent 多试几轮更容易越改越对；但像科学计算这类中间拿不到对错反馈的长任务，单纯地放宽步数和时长往往只会让 Agent 在死胡同里白跑——这时候及时发现它卡在哪一步、督促它换思路或停下，远比硬堆 Token 管用。

## 6. 接下来我们做什么？

跑完这 600 次测试，这 50 道题就成了我们后续迭代 Harness 的固定基线。接下来每次改提示词、调工具链，我们都会在这条基线上重点推进三件事：

1. **把“三轮过两轮”的题目推上“三轮全过”**：重点排查 PenguinHarness 那 12 道“三轮过两轮”的题是怎么挂掉的，让 Agent 在交卷前多跑一步自检，解决发挥不稳定的问题。
2. **每次评测逐题比对，不光看总分**：每次改版跑满三轮后，直接对比 50 道题每一题的通过情况，防止被“修好 A 题、弄坏 B 题”的同分假象骗过去。
3. **给长耗时任务加上超时提醒，卡住时及时换思路**：重点盯着 Sec D 科学计算题，当 Agent 卡在同一条死胡同里长时间没进展时，及时提醒它换个做法或停下，别再白跑到超时。

**实验数据快照**：本文全部数据对应 [Prism-Shadow/penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/6ad65ea054fe8035c1c48724dbb5626d699f6cb2) 仓库快照 6ad65ea054fe8035c1c48724dbb5626d699f6cb2。相关文档：[横评归档目录](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/experiments/harness-comparison) · [仓库运行说明 README.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/README.zh.md) · [50 题筛选说明 SELECTION.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/SELECTION.zh.md) · [评测集数据说明 data/README.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/data/README.md) · [PenguinAgent 适配器说明](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/agents/README.md) · [评估数据与提交流程规范](https://club.penguin.ooo/zh/workflow/evaluation/)
