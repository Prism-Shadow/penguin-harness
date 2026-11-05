---
title: "使用 PenguinHarness 组织不同 Harness 的对比实验"
date: 2026-11-05
category: practice
excerpt: "固定底层模型与思考强度，在五个评测集、共 50 道题上对 PenguinHarness、DSH、Pi、Codex 四种 Harness 开展三轮对比实验，拆解任务通过率、多轮稳定性与资源开销差异，并说明如何通过 PenguinHarness 组织和复现这套评测。"
---

同一个模型，放进不同的 Harness 里，执行任务的表现往往存在明显差距。在优化 Harness 或引入 RSI 算法改进 Agent 之前，需要先建立一条固定基线：当底层模型完全固定时，切换不同的 Harness，最终的任务通过率、多轮运行的稳定性和资源开销会差多少？

本文整理了 PenguinHarness、DSH、Pi、Codex 四种 Harness 在五个评测集、共 50 道题上的三轮测试对比结果，并说明模型配置、实验启动流程，以及如何通过 PenguinHarness 组织和复现这套评测。

## 1. 实验设计与任务设定

四组实验统一接入模型 DeepSeek-V4.1-Flash-1017，思考强度固定为 max，被测版本分别锁定为 PenguinHarness 0.2.17、DSH 0.2.1-rc.2、Pi 1.4.0 与 Codex 0.162.1，通过 Harbor 0.23.0 在独立 Docker 容器中各自将 50 道题完整测试 3 轮，合计完成 600 次作答：

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/03-experiment-design.png" width="2880" height="1730" alt="图 1｜实验设计：四种 Harness 锁定版本号，在相同的模型配置下，对 A–E 五个子集共 50 道固定任务各测试三轮，合计完成 600 次作答。" /><figcaption>图 1｜实验设计：四种 Harness 锁定版本号，在相同的模型配置下，对 A–E 五个子集共 50 道固定任务各测试三轮，合计完成 600 次作答。</figcaption></figure>

这 50 道题目从五个公开基准的 864 道候选题中经两轮实测筛选得出，完整筛选过程见仓库 [SELECTION.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/SELECTION.zh.md)。第一轮剔除了依赖 GPU、多容器编排、内存超过 8 GB 或运行期需下载大权重文件的题目，确保单台纯 CPU 机器即可跑完，且单轮 50 题的 API 费用控制在 $20 以内；第二轮根据试跑得分分布校准难度梯度，最终固定为 A 至 E 五个评测集，每个评测集 10 道题：

| 子集 | 评估集 ID | 上游来源 | 考察内容 | 单题时限 | 请求上限 |
| --- | --- | --- | --- | --- | --- |
| Sec A | penguinharness-benchmark-sec-a | Data Analysis Bench | 跨多源文档、表格与数据库清洗计算并输出结论 | 15m | 100 |
| Sec B | penguinharness-benchmark-sec-b | DeepSWE v1.1 | 在真实开源仓库中定位缺陷、编写补丁并通过回归测试 | 30m | 250 |
| Sec C | penguinharness-benchmark-sec-c | AutomationBench | 调用业务系统与本地服务接口，完成多步骤自动化流程 | 10m | 50 |
| Sec D | penguinharness-benchmark-sec-d | Terminal-Bench-Science 0.1 | 在 Linux 终端完成天体物理、生物信息等科学计算建模 | 40m | 320 |
| Sec E | penguinharness-benchmark-sec-e | Terminal-Bench 4.0 | 在真实终端完成系统排障、存储引擎修复与编译调试 | 25m | 200 |

## 2. 模型配置与实验启动流程

用 PenguinHarness 组织和复现这套实验，需要先配好模型与思考强度，再按被测对象走对应的启动路径。如图 2 所示，评测 PenguinHarness 内部 Agent 时，从评估中心调用预置的 `agent-evaluation` 技能发起；评测 DSH、Pi、Codex 等外部 Harness 时，则在工作区对话中由组织 Agent 调用自定义批处理脚本。两条路径共用底层的 Harbor 容器调度与独立验证器判分。

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/04-penguin-reproduction-flow.png" width="2880" height="2080" alt="图 2｜复现组织方案：上层由 PenguinHarness 的组织 Agent 发起；内部 Agent 走左侧评估中心与 agent-evaluation 技能路径，DSH、Pi、Codex 走右侧自定义批处理路径；底层共用 Harbor 容器调度、适配器加载、独立验证器判分与结果归档。" /><figcaption>图 2｜复现组织方案：上层由 PenguinHarness 的组织 Agent 发起；内部 Agent 走左侧评估中心与 agent-evaluation 技能路径，DSH、Pi、Codex 走右侧自定义批处理路径；底层共用 Harbor 容器调度、适配器加载、独立验证器判分与结果归档。</figcaption></figure>

**第一步：配置模型与思考强度**

在 PenguinHarness Web 界面的模型设置中，选择提供商 `deepseek`，添加模型 `DeepSeek-V4.1-Flash-1017` 并保存 API Key；也可以在终端通过 CLI 注册并设为默认模型：

```bash
penguin config model add \
  --provider deepseek \
  --model-id DeepSeek-V4.1-Flash-1017 \
  --api-key <YOUR_API_KEY> \
  --set-default
```

需要注意，**组织会话与被测 Agent 的思考强度是分开生效的**：在聊天输入框下方将思考强度切到 `Max`，只作用于当前负责编排实验的组织会话；通过 `agent-evaluation` 技能评测内部 Agent 时，被测 Agent 的 `thinking_level` 会从其自身的配置文件 `system_config.yaml` 中读取，因此实验前需先在被测 Agent 的设置中将思考强度设为 `max`。通过批处理脚本测试外部 Harness 时，则在启动参数中显式传入 `thinking=max`。

**第二步：评测 PenguinHarness 内部 Agent——评估中心与 `agent-evaluation` 技能**

新建的 PenguinHarness Project 已内置 Sec A 至 Sec E 五个评测集，默认智能体 `default_agent` 也已预装 `Default RSI Toolkit` 插件中的 `agent-evaluation` 技能。对应图 2 左侧分支，发起评测分为三步：

- **在评估中心选择参数**：进入左侧「评估中心」，点击目标评测集右上角的「使用」，在「评估」标签页设置四项参数——被测智能体选 `default_agent`，执行评估的智能体选装有 `agent-evaluation` 技能的 `default_agent`，评估会话模型选 `deepseek/DeepSeek-V4.1-Flash-1017`，运行次数 `runs` 填 `3`。
- **预选技能并发送指令**：点击确认后，系统会自动新建对话、预选 `agent-evaluation` 技能并填入评估指令；也可以手动新建对话，勾选 `agent-evaluation` 技能后发送以下指令：

```markdown
[use_skills]
- agent-evaluation
[/use_skills]
请使用 `agent-evaluation` Skill，在这套已冻结的 Benchmark 上评估被测智能体。

- test_agent_id：`default_agent`
- benchmark_id：`penguinharness-benchmark-sec-e`
- runs：`3`
```

- **主会话派发评测 Worker**：收到指令后，主会话先按 `agent-evaluation` 技能规范检出仓库快照、创建共享 Docker 网络并构建离线安装包，随后循环调度 `10 题 × 3 轮 = 30` 个评测单元，通过 `run_subagent` 在后台并发派发子会话 Worker，默认最多同时运行 4 个。每个 Worker 每次只接收**一个内部 `test_agent_id`、一道题目和一次运行编号**，打包被测 Agent 的 `agent_state` 并在独立 Docker 容器中调用 `harbor run` 完成作答与判分；30 个单元全部返回后，主会话汇总均分并写入该评测集的 `scoreboard.yaml`。

**第三步：评测 DSH、Pi、Codex——工作区对话调用自定义批处理**

`agent-evaluation` 技能面向 PenguinHarness 内部的 `test_agent_id`，不会在单条指令里直接驱动外部命令行工具。评测 DSH、Pi、Codex 时，需通过各自的 Harbor 适配器与任务配置接入，对应图 2 右侧分支：

> **PenguinHarness 工作区对话启动批处理脚本 → `harbor run -c <任务配置> -y` → 容器内加载对应适配器运行被测 Harness → 独立验证器判分 → 归档逐题记录与统计汇总**

在 PenguinHarness 中新建一个绑定评测仓库工作区的普通对话，无需勾选 `agent-evaluation` 技能，直接由组织 Agent 运行批处理脚本或按子集配置调用 Harbor：

```bash
export PYTHONPATH="$PWD/agents"
uvx --from harbor==0.23.0 harbor run \
  -c benchmarks/terminal-bench/job.yaml \
  -a <harness_adapter_module>:<AdapterClass> \
  -m deepseek/DeepSeek-V4.1-Flash-1017 \
  --ak thinking=max \
  --ak run_timeout=25m --ak max_turns=200 \
  --job-name terminal-bench-attempt-1 -y
```

其中 `-a` 指定被测 Harness 的适配器，如 `penguin_agent:PenguinAgent` 或 DSH、Pi、Codex 各自的适配器实现。脚本按第 1 至第 3 轮顺序跑完五个子集，每轮结束后生成标准格式的 `meta_info.yaml`、`test/attempt-1..3.yaml` 与 `test/summary.yaml`。

## 3. 四组实验共同遵循的执行与判分规则

无论是通过 `agent-evaluation` 技能派发评测 Worker，还是通过批处理脚本调用 Harbor，四种被测 Harness 在环境准备、网络隔离、容器内执行与异常重跑上均遵循同一套规则。在每个独立任务容器内部，被测的 PenguinHarness 与 DSH、Pi、Codex 处于完全对等的位置，统一由 Harbor 调度并交由独立验证器判分。

**第一环节：准备离线运行包与隔离密钥**

开跑前，先锁定 50 道题对应的 40 位仓库提交快照、被测 Harness 版本号与各子集运行上限。为避免每个容器启动时重复从公网下载运行环境，或污染题目容器原有的 Python 与 Node 工具链，宿主机预先将各被测运行环境打包为离线安装包，容器启动时直接挂载解压到独立目录。同时，适配器只从宿主机配置中提取当前被测模型的单条密钥，写入容器日志目录之外的临时私有路径，并在单题结束后立即擦除，确保密钥不会出现在命令行参数或归档日志中。

**第二环节：单题冒烟验证与批量并发控制**

正式拉起三轮完整实验前，先以单并发跑通一道题，核实离线包解压、模型请求、产物落盘与验证器判分全链路正常，再推进五个子集的批量运行。批量运行期间执行两项环境控制：

- **子集网络隔离**：Sec A、C、D、E 允许访问公网并复用 `penguin-bench` 共享桥接网络；而考察开源仓库缺陷修复的 Sec B 全程禁用公网，仅通过 `--allow-agent-host` 放行模型 API 主机，防止被测 Agent 搜索线上现成的修复 PR 或 Issue。
- **并发度与 Docker 地址池管理**：Harbor 默认会为每个任务容器创建独立网络，而标准 Docker 守护进程默认仅提供 31 个子网地址池。使用 `agent-evaluation` 技能复现时默认最多并发运行 4 个子会话；在预先配置共享桥接网络或扩容地址池的批处理服务器环境中，历史实验曾以最高 10 并发运行以缩短墙钟耗时。

**第三环节：单题容器内执行与独立判分**

每道题的单次作答即一个 Trial，由 Harbor 在独立容器中按图 3 的任务输入、被测 Harness 执行、结束作答三个阶段完成闭环。被测 Harness 读取任务说明与初始文件，在模型推理与工具执行之间循环往返，把修改后的代码或数据写入工作目录，直到主动结束或达到时限与请求上限。这里最关键的设计是**“运行记录”与“验证器判分”分流记录、完全解耦**：作答结束后，运行器与适配器负责记录结束状态、运行耗时、三类 Token 与 API 费用；独立验证器则只检查工作目录中的任务产物并给出 100 或 0 分，两类记录最终合并为逐题归档。

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/05-trial-execution.png" width="2880" height="1750" alt="图 3｜单题执行与判分：被测 Harness 在模型推理与工具执行之间循环，将任务产物写入工作目录；作答结束后，独立验证器检查工作目录产物并给出 100 或 0 分，运行器与适配器记录结束状态、耗时、三类 Token 和 API 费用，两路结果合并归档。" /><figcaption>图 3｜单题执行与判分：被测 Harness 在模型推理与工具执行之间循环，将任务产物写入工作目录；作答结束后，独立验证器检查工作目录产物并给出 100 或 0 分，运行器与适配器记录结束状态、耗时、三类 Token 和 API 费用，两路结果合并归档。</figcaption></figure>

以 Sec E 第 8 题 `embedding-drift-monitor` 嵌入漂移监测修复任务为例：容器启动后挂载了存在误报、漏报与告警跳变缺陷的监测代码及测试数据；被测 Harness 读取任务说明，在终端检查数据分布并修改统计检验与防抖逻辑，直至主动退出，或触及该子集 25 分钟、200 次模型请求的上限后停止。

随后独立验证器介入执行验收测试。在这道题上，Codex 三轮都在 8–9 分钟内主动正常退出，但留下的代码未通过验收测试，三轮全得 0 分；而 PenguinHarness 与 DSH 三轮修改的代码均通过验证拿到 100 分——哪怕某个 Agent 在超时前一刻才改对代码、随后因达到时限被系统强制停止，只要工作目录留下的代码通过验证规则，同样拿满 100 分。

**第四环节：筛查未启动异常并生成标准归档**

每轮运行结束后，系统按 `tools/measure/reruns.py` 的规则核查完整性，严格区分“环境未就绪”与“作答失败”：只有当容器因服务启动失败、配置异常导致缺少 `agent_execution.started_at` 或模型请求数为 0，或者 `exception_info` 明确记录 Docker 地址池耗尽未能分配网络时，才判定为未实质启动并降低并发补跑；一旦 Agent 已经发出模型请求开始作答，无论中途工具报错还是超时停止，一律保留原始结果；若因验证器自身故障未能产出分值，则作为无效试次单独排查，不直接记为 0 分。

## 4. 评分与统计方法

600 次作答全部归档后，按统一口径汇总得分与运行开销，完整规范见[评估数据与提交流程规范](https://club.penguin.ooo/zh/workflow/evaluation/)。

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/06-statistics-method.png" width="2880" height="2392" alt="图 4｜统计方法：以 DSH 为例，01 先对当轮子集内 10 道题取平均得到单轮子集分；02 再将同轮 A–E 五个子集等权平均，得到三轮总体得分 40、38、38；03 最后跨三轮计算均值 38.67 与样本标准差 1.15，样本标准差分母为 3 - 1 = 2。" /><figcaption>图 4｜统计方法：以 DSH 为例，01 先对当轮子集内 10 道题取平均得到单轮子集分；02 再将同轮 A–E 五个子集等权平均，得到三轮总体得分 40、38、38；03 最后跨三轮计算均值 38.67 与样本标准差 1.15，样本标准差分母为 3 - 1 = 2。</figcaption></figure>

**得分与样本标准差**

单题通过记 100 分，未通过记 0 分。每种 Harness 在三轮实验中合计作答 150 题次，每多通过 1 题次，总体均分就增加 0.67 分。如图 4 所示，得分汇总按三步逐层计算，样本标准差分母取 `3 - 1 = 2`：

- **01 单轮子集分**：先对当轮某个子集的 10 道题求平均，得到该子集的单轮得分。若要看单个子集跨三轮的表现，直接对该子集的三轮得分计算均值与样本标准差，例如 DSH 在 Sec E 的三轮得分为 10、20、30，记为 20.00 ± 10.00。
- **02 单轮总体得分**：在同一轮内，将 A 至 E 五个子集的单轮得分等权平均，得到该轮 50 道题的总体得分。例如 PenguinHarness 三轮总体得分为 36、40、38，DSH 三轮总体得分为 40、38、38。
- **03 跨三轮均值与样本标准差**：用三个轮次的总体得分计算最终均分与样本标准差。例如 PenguinHarness 汇总为 38.00 ± 2.00，DSH 汇总为 38.67 ± 1.15。

之所以先按轮次对齐算出每轮总体得分、再跨三轮求标准差，是为了避免直接拿五个子集均分求标准差时混入不同题型本身的难度差异，也避免直接平均各子集标准差而忽略同一轮内不同子集之间的涨跌抵消。

**单轮运行开销**

将 A 至 E 五个子集的三轮平均开销相加，用来衡量跑完完整一轮 50 道题的平均资源投入：

- **API 费用**：按统一目录单价计算的五个子集单轮平均费用之和；由于各子集归档费用已做四舍五入，文中统一记为约数。
- **累计 Agent 运行时间**：50 道题在各自容器内运行耗时的直接累加，反映单轮总计算时长而非并行执行时的墙钟等待时间；以 4 并发调度时，整轮实验的实际等待时间约为累计运行时间的四分之一。
- **三类 Token 用量**：多轮工具调用中，终端输出与历史消息会作为后续轮次的输入重复发送，原始输入总量中已包含缓存读取部分。为避免重复累加，文中按图 10 口径将 Token 拆分为**非缓存输入**、**缓存读取**和**输出**三项；其中输出仅包含模型自身生成的思考内容、回复文本与工具调用参数，不包含工具返回结果。

## 5. 实测结果与数据洞察

四种 Harness 在五个评测集、共 50 道题上的三轮总体得分如下：

- **PenguinHarness**：38.00 ± 2.00，三轮总分 36 / 40 / 38，150 次作答通过 57 次
- **DSH**：38.67 ± 1.15，三轮总分 40 / 38 / 38，150 次作答通过 58 次
- **Pi**：34.00 ± 3.46，三轮总分 32 / 38 / 32，150 次作答通过 51 次
- **Codex**：30.00 ± 2.00，三轮总分 32 / 28 / 30，150 次作答通过 45 次

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/01-overall-bars.png" width="2880" height="1140" alt="图 5｜总体得分对比：横条表示四种 Harness 在五个评测集、共 50 道题上的三轮总体均分，端部误差线表示正负 1 个样本标准差，分母取 3 - 1 = 2。" /><figcaption>图 5｜总体得分对比：横条表示四种 Harness 在五个评测集、共 50 道题上的三轮总体均分，端部误差线表示正负 1 个样本标准差，分母取 3 - 1 = 2。</figcaption></figure>

结合五个子集的得分分布、逐题通过频次与资源开销，实验结果呈现出四项主要发现：

**第一，不同题型的得分分化显著，600 次作答并集划出了“模型能力边界”与“Harness 优化空间”的分水岭。**

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/02-subset-bars.png" width="2880" height="3260" alt="图 6｜五个子集的得分对比：A–E 五个子集各 10 题的三轮均分与样本标准差，所有面板统一采用 0 至 100 分刻度，黑色端帽表示正负 1 个样本标准差。" /><figcaption>图 6｜五个子集的得分对比：A–E 五个子集各 10 题的三轮均分与样本标准差，所有面板统一采用 0 至 100 分刻度，黑色端帽表示正负 1 个样本标准差。误差线在 0–100 边界处截断。</figcaption></figure>

如图 6 所示，没有单一 Harness 在全部五个子集上同时占优。在 Sec A 数据分析上，PenguinHarness 以 70.00 ± 10.00 与 DSH 的 70.00 ± 0.00 并列第一；在断网隔离的 Sec B 软件工程上，PenguinHarness 以 70.00 ± 10.00 取得单子集最高分，三轮得分为 60、70、80，DSH、Pi、Codex 分别为 63.33 ± 15.28、60.00 ± 10.00 与 53.33 ± 5.77；在 Sec C 自动化工作流上，DSH 以 36.67 ± 5.77 居首，PenguinHarness 为 30.00 ± 10.00；在 Sec E 终端任务上，Pi 取得最高均分 23.33 ± 15.28，高于 PenguinHarness 的 20.00 ± 0.00 与 DSH 的 20.00 ± 10.00；而 Sec D 科学计算则是所有被测 Harness 的共同短板，均分都在 0.00 到 10.00 之间。

把四种 Harness 的三轮共 600 次作答取并集，每道题共经历了 12 次尝试：50 道题中有 19 道题在 12 次尝试中无一通过，其中 Sec D 科学计算占 7 题、Sec C 与 Sec E 各占 5 题、Sec A 占 2 题；其余 31 道题至少被某一种 Harness 解出过，当中又有 17 道题四种 Harness 全部能够解出，Sec B 的 10 道软件工程题更是全部被打通。这组数据划出了底层模型能力边界与 Harness 工程空间的界限：在那 19 道零通过题目上，受限于固定模型 DeepSeek-V4.1-Flash-1017 本身在专业科学计算或复杂系统领域的能力上限，单靠更换 Harness 难以凭空产生解题能力；而在模型已经具备求解能力的 31 道题、对应 62 分的理论上限内，单轮运行平均只能拿到 30.00 至 38.67 分，中间超过 23 分的落差全部损耗在执行稳定性上。

**第二，各组“至少解出一次”的题目数高度接近，真正拉开总分差距的是摇摆题在“通过两次”与“仅过一次”之间的分布差异。**

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/09-pass-frequency.png" width="2880" height="1330" alt="图 7｜通过频次分布：按每道题三次作答中的通过次数分为 0/3、1/3、2/3、3/3 四档，右侧标注三轮至少通过一次的不同题目总数。" /><figcaption>图 7｜通过频次分布：按每道题三次作答中的通过次数分为 0/3、1/3、2/3、3/3 四档，右侧标注三轮至少通过一次的不同题目总数。</figcaption></figure>

| Harness | 3 / 3 次通过 | 2 / 3 次通过 | 1 / 3 次通过 | 至少通过一次 | 0 / 3 次通过 | Sec B：全过 / 两轮过 / 单轮过 |
| --- | --- | --- | --- | --- | --- | --- |
| PenguinHarness | 10 题 | 12 题 | 3 题 | 25 题 | 25 题 | 3 题 / 5 题 / 2 题，合计 10 / 10 题过 |
| DSH | 13 题 | 7 题 | 5 题 | 25 题 | 25 题 | 2 题 / 5 题 / 3 题，合计 10 / 10 题过 |
| Pi | 11 题 | 5 题 | 8 题 | 24 题 | 26 题 | 4 题 / 2 题 / 2 题，合计 8 / 10 题过 |
| Codex | 8 题 | 7 题 | 7 题 | 22 题 | 28 题 | 2 题 / 4 题 / 2 题，合计 8 / 10 题过 |

如图 7 与上表所示，只看“三轮至少通过一次”的题目总数，PenguinHarness 和 DSH 都是 25 题，Pi 是 24 题，Codex 是 22 题，四者最多只差 3 道题；但在各自能够解出的这 22–25 道题里，有 12–15 道题属于只通过 1 轮或 2 轮的摇摆题，占各组已解出题目的 48%–64%，且内部频次结构差异明显：

- **PenguinHarness 与 DSH 的同分段异构**：两者同样解出 25 道题、总通过题次仅差 1 次，但 DSH 将更多题目稳定在了“3 / 3 次通过”档位，共 13 题；而 PenguinHarness 有 12 道题集中在“2 / 3 次通过”档位，占其全部 15 道摇摆题的 80%，“1 / 3 次通过”的仅有 3 题。
- **Pi 与前两名的分差来源**：Pi 的“3 / 3 次通过”达到 11 题，比 PenguinHarness 还多 1 题，至少通过一次的也有 24 题，但总体均分却比前两名低了 4.00–4.67 分；原因在于其 13 道摇摆题中有 8 道停留在“1 / 3 次通过”，能够通过两次的只有 5 道。
- **Sec B 软件工程的高频摇摆现象**：在 Sec B 中，PenguinHarness 和 DSH 在三轮内把全部 10 道题都解出过至少一次，但三轮全过的分别只有 3 题和 2 题，各有 5 道题落在“2 / 3 次通过”。对这批软件工程任务而言，核心瓶颈并非缺乏解题能力，而是多轮代码修改与回归验证的稳定性。

**第三，三轮均分相同、标准差为 0.00，不代表每轮做对了相同的题目。**

以图 8 中 PenguinHarness 在 Sec E 的逐题结果为例：三轮每轮均通过 2 题，当轮子集均分都是 20 分，汇总得分为 20.00 ± 0.00，但真正三轮全过的只有 `CASE-008 嵌入漂移监测` 一题；第 2 个通过名额在第 1 轮来自 `CASE-010 FreeCAD 平台建模`，到了第 2、3 轮则换成了 `CASE-004 MVCC / LSM 压缩`。

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/07-task-stability.png" width="2880" height="1560" alt="图 8｜单子集逐题稳定性：PenguinHarness 在 Sec E Terminal-Bench 4.0 子集的逐题得分记录。三轮均为 2 / 10 题通过，三轮均分 ± 样本标准差为 20.00 ± 0.00；但第一轮通过 CASE-010 FreeCAD 平台建模，后两轮改为通过 CASE-004 MVCC / LSM 压缩。" /><figcaption>图 8｜单子集逐题稳定性：PenguinHarness 在 Sec E Terminal-Bench 4.0 子集的逐题得分记录。三轮均为 2 / 10 题通过，三轮均分 ± 样本标准差为 20.00 ± 0.00；但第一轮通过 CASE-010 FreeCAD 平台建模，后两轮改为通过 CASE-004 MVCC / LSM 压缩。</figcaption></figure>

核查全部 4 组非零分且标准差为 0.00 的子集实验，只有 DSH 在 Sec A 的 70.00 ± 0.00 是由相同的 7 道题在三轮中固定通过；其余 3 组均出现了不同题目在轮次间的一增一减抵消。除图 8 的 PenguinHarness 在 Sec E 的记录外，Codex 在 Sec A 的 60.00 ± 0.00 在第 2 轮由 CASE-002 与 CASE-007 互换得分；而在 Sec D 的 10.00 ± 0.00 甚至没有任何一道题三轮全过，靠第 1 轮通过 CASE-010 小行星定轨、第 2 和第 3 轮通过 CASE-003 脑成像配准，刚好凑出了三个 10 分。

**第四，前缀缓存读取占比超过 98.5%，单轮 $2.91–$4.07 的 API 费用差异主要由输出 Token 与重度子集投入决定。**

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/08-resource-comparison.png" width="2880" height="1640" alt="图 9｜单轮费用与耗时对比：四种 Harness 完成一轮 50 道题的 API 费用与累计 Agent 运行时间，均取三轮平均值。" /><figcaption>图 9｜单轮费用与耗时对比：四种 Harness 完成一轮 50 道题的 API 费用与累计 Agent 运行时间，均取三轮平均值。</figcaption></figure>

<figure class="post-figure"><img class="w-full rounded-lg border border-gray-200 dark:border-gray-800" src="/blog-screenshots/harness-comparison/08b-token-comparison.png" width="2880" height="2260" alt="图 10｜单轮三类 Token 用量对比：四种 Harness 完成一轮 50 道题的非缓存输入、缓存读取与输出 Token 用量，均取三轮平均值，单位为百万 Token。" /><figcaption>图 10｜单轮三类 Token 用量对比：四种 Harness 完成一轮 50 道题的非缓存输入、缓存读取与输出 Token 用量，均取三轮平均值，单位为百万 Token。</figcaption></figure>

| Harness | API 费用 | 累计 Agent 运行时间 | 非缓存输入 | 缓存读取 / 命中率 | 输出 Token |
| --- | --- | --- | --- | --- | --- |
| PenguinHarness | ≈ $4.07 | 11.85 h / 42,670 s | 3.21 M | 351.86 M / 99.1% | 4.56 M |
| DSH | ≈ $3.82 | 11.03 h / 39,711 s | 3.90 M | 357.42 M / 98.9% | 3.91 M |
| Pi | ≈ $3.11 | 10.82 h / 38,942 s | 3.43 M | 232.54 M / 98.5% | 3.41 M |
| Codex | ≈ $2.91 | 9.51 h / 34,252 s | 3.51 M | 271.18 M / 98.7% | 2.86 M |

如图 9、图 10 与上表所示，四种 Harness 单轮总输入都在 2.36 亿到 3.61 亿 Token 之间，但由于多轮工具调用持续复用同一长会话前缀，98.5%–99.1% 的输入属于低单价的缓存读取，非缓存输入均在 3.21 M–3.90 M 的窄区间内。因此，整轮 API 费用的排序与单价更高的输出 Token 用量完全一致。

拆解到各子集，费用与耗时集中在两类重度任务上：一是 Sec B 软件工程子集，PenguinHarness 与 DSH 在该子集分别输出了 1.45 M 和 0.88 M Token、对应单子集费用 $1.48 和 $1.06，高于 Pi 的 $0.83 与 Codex 的 $0.82，较高的多轮交互投入换来了更高的子集得分，但多出的输出 Token 中有多少属于有效验证、多少属于冗余重试，仍需结合执行轨迹拆解；二是 Sec D 科学计算子集，10 道题占去了各组整轮 34%–53% 的累计运行时间，合计达 4.03–5.15 小时，平均每题耗时 24–31 分钟，但各组得分均在 10.00 分及以下。在保留了逐题耗时的 DSH 与 Codex 记录中，分别有 10 / 30 次和 12 / 30 次尝试耗时超过 35 分钟，接近 40 分钟时限。

**后续工作：这套基线用来检查哪些改动？**

这 50 道题已完成逐题拆解，后续将作为检验 Harness 工程改动的固定回归基线，重点检查三方面变化：

- **高频摇摆题的收敛情况**：对照 Sec A、Sec B、Sec C 的执行轨迹，检查提示词与自测流程改动后，“2 / 3 次通过”的高频摇摆题能否稳定收敛为三轮全过，同时 Sec B 较高的输出 Token 消耗能否下降。
- **逐题通过矩阵的退化检查**：每次版本迭代直接比对三轮逐题得分矩阵，防止轮次间不同题目的一增一减掩盖真实退化。
- **长耗时子集的执行效率**：跟踪 Sec D 的单题耗时分布与终止状态，验证超时提醒或早停机制能否减少无效长耗时尝试。

至于需要避免公开题目过拟合的 RSI 实验，则交由仓库中划分了独立训练集与留出测试集的 GDPevo 基准开展。

*实验数据快照：本文全部数据对应 [Prism-Shadow/penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/6ad65ea054fe8035c1c48724dbb5626d699f6cb2) 仓库快照 6ad65ea054fe8035c1c48724dbb5626d699f6cb2。相关文档：[横评归档目录](https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/experiments/harness-comparison)、[仓库运行说明 README.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/README.zh.md)、[50 题筛选说明 SELECTION.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/SELECTION.zh.md)、[评估集导入包说明 packages/README.zh.md](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/packages/README.zh.md)、[PenguinAgent 适配器说明](https://github.com/Prism-Shadow/penguin-harness-benchmark/blob/6ad65ea054fe8035c1c48724dbb5626d699f6cb2/agents/README.md)、[评估数据与提交流程规范](https://club.penguin.ooo/zh/workflow/evaluation/)*
