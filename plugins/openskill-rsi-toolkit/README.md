# OpenSkill RSI Toolkit

在 Penguin Harness 中通过独立检索、虚拟验证和反馈修订构建可复用技能；全部技能冻结后，
再比较 Baseline 与 OpenSkill 的正式成绩。模型权重不变，构建阶段不使用真实任务评分。

## 安装和启动

在目标 Penguin Harness 服务启动且 CLI 已连接到该服务后，从项目根目录安装：

```bash
penguin plugin install ./plugins/openskill-rsi-toolkit --project-id <project_id> --json
```

升级已安装的同名插件时加 `--overwrite`。这是 Harness 自带的本地插件安装入口，适用于
源码试用。OpenSkill 也已登记到 core、CLI 和桌面端的内置插件依赖中，随 Harness 打包。安装后可在
插件页面选择 OpenSkill，或在评估中心选择该方法；将技能装到 Optimizer，Target 保持独立。

示例提示词：

> 使用 OpenSkill 在项目内的 Benchmark Sec A 上构建一次技能、完整测试三次，模型使用 deepseek v4.1 flash max，并比较 Baseline。

> 使用 OpenSkill 在项目内的 GDPEVO-CRM Train / Test 上构建一次技能、完整测试三次，模型使用 deepseek v4.1 flash max。

首次未指定 Target 时，可直接要求新建空白 Target。Benchmark 必须已经发布；若缺少某个
领域的配对 Test 包，先通过评估中心导入它。无需提供之前实验的 GitHub 分支、SSH 脚本或服务器路径。

## 当前 Benchmark 的适配

- 从项目 `benchmarks/<id>/benchmark_config.toml` 和 Case statement 读取实际配置。
- Harbor 的任务路径与版本来自 statement，分支在实验开始时固定到提交；Baseline 与
  OpenSkill 共用该提交。内置包仍可能需要下载 Harbor 任务和环境镜像。
- 支持 GDPevo 按领域拆分的 Train/Test 包、`train_tasks` 中的多个问题及相邻共享 `env/`。
  一个训练组保持为一个构建 Case，并记录其问题数；正式对比写入配对 Test 的 scoreboard。
- 训练环境的真实 `/api/judge` 不属于虚拟验证。实践镜像必须移除评分材料，启动时禁用
  该接口，独立验证器继续产生反馈；不会把原生连续训练评分冒充 OpenSkill Train 分数。
- 保留最终版本导出、固定模型、持久 creator、独立 verifier、分级恢复预算与停止机制。

## 实验组织和统计

每个 Benchmark 或独立训练单元构建一次技能，冻结后分别对 Baseline 与 OpenSkill
完整测试三次。三次使用同一份冻结 State，每个任务都使用新的环境和会话。多个领域
各自构建技能并保存独立结果；默认不会重新训练三次。构建预算为每个 Case 360 分钟。

每轮先计算整个 Test 集的平均分，再对三个轮次分数计算均值和样本标准差（分母 `n−1`）。
多个 Benchmark 的总结果先在每轮内平均各 Benchmark 分数，再计算轮间标准差。
保留逐任务统计和“逐任务样本方差的均值”，但不将其当作总成绩的方差。仅一次测试时
样本标准差为空；一次技能构建不产生跨训练轮次标准差。

插件的 `evaluation_results.py` 从冻结日志和完整结果矩阵生成统计数据及原生 scoreboard
记录，拒绝缺失、重复或身份不一致的结果。详见
[实验组织与统计](skills/openskill-rsi-toolkit/references/experiment-organization.md)。

结果报告还记录实验及组件版本、Baseline/Final 的提升、训练单元和每道 Test 题每轮的
金额、起止时间、耗时及 token（缓存输入、非缓存输入、输出、总输入、总量）。Train、
Test、主控分别汇总，失败尝试计入消耗；不重复累加父子调用或恢复会话的累计用量。
缺失值保持 `null`，同时提供已知小计和覆盖情况。多个 Skill 共同构建时记录共享成本。

OpenSkill 的训练曲线记录虚拟验证及反馈修订；不补造真实 Train accuracy。
Baseline 是训练前保存、冻结后才测分的 State。Benchmark 将指标定义为 accuracy 时，
报告 accuracy 及其标准差；其他奖励分保留原指标名。字段和采集命令见
[结果记录约定](skills/openskill-rsi-toolkit/references/result-records.md)。

入口见 [SKILL.md](skills/openskill-rsi-toolkit/SKILL.md)，布局及执行约定见
[native-benchmarks.md](skills/openskill-rsi-toolkit/references/native-benchmarks.md)。

运行需要 Linux、Docker、Python 3.11+、Node 24+、完整的当前 Penguin core SDK，以及已配置的模型。
实践镜像必须经过隔离检查。该插件不会修改已有实验、Benchmark 题目或评分规则。
