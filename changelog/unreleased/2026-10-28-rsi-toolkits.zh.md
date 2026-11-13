# RSI 实验工具包

- **Date:** 2026-10-28
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#1374](https://github.com/Prism-Shadow/penguin-harness/pull/1374)

[English](2026-10-28-rsi-toolkits.md)

新增四个 RSI 工具包，由主控 Penguin 读取 Project 中选定的 Benchmark，组织学习，并比较冻结的基线与最终 State。

## 方法与负责人

| 方法 | 负责人 | 学习过程 |
| --- | --- | --- |
| SkillAdam | [Saigyouji-Yuyuko1000](https://github.com/Saigyouji-Yuyuko1000) | 持续更新问题记录、自适应调整编辑预算、配对评测候选。 |
| SkillOpt | [Saigyouji-Yuyuko1000](https://github.com/Saigyouji-Yuyuko1000) | 有界编辑、候选评分门槛和 slow/meta 更新；无独立验证集时复用 Train 筛选候选。 |
| OpenSkill | [ArisaZz](https://github.com/ArisaZz) | 外部检索与独立虚拟验证，在目标任务评分前冻结最后版本。 |
| TRACE | [rank-Yu](https://github.com/rank-Yu) | Curator／Actor 根据轨迹学习，完成全部训练测量后选择版本。 |

共同汇报规范与插件集成：[Saigyouji-Yuyuko1000](https://github.com/Saigyouji-Yuyuko1000)。

## 统一实验记录

- 每个独立单元训练一次，默认对冻结的 baseline／final 各完整测试三次；每道测试题使用新的环境与会话。
- 对完整测试重复得分计算均值与样本标准差。每次先汇总题目；跨 Benchmark 总结果再先逐次平均各 Benchmark。Train 与 Test 分开统计。
- 记录实验、组件及 State 版本，优先采用用户指定版本。按训练单元和每道测试题的每次作答记录费用、时间，以及缓存输入、非缓存输入和输出 token。
- 对比统一使用 `baseline`／`final`，训练进度使用编号的 `step`，保留原阶段名称用于追溯。SkillAdam、SkillOpt 和 TRACE 记录训练测量；SkillOpt 区分执行批次与候选筛选曲线，OpenSkill 记录虚拟验证。
- 仓库中的任务使用选定包及 Case 说明声明的完整 commit，学习和全部测试重复均保持一致。

## 打包

四个插件均已登记到 core、CLI、桌面端、中英文插件目录、自我进化文档、官网算法清单和 UI Gallery 演示。

各 toolkit 保留方法说明和必要参考文档，使用 Penguin 现有工具及选定 Benchmark 的运行环境，不附带独立实验执行器、特定数据集启动器、恢复框架或开发测试。统一评测与汇报说明，沿用原生 scoreboard 格式及完整测试重复的统计口径。

Windows Web 测试在匹配 Socket 测试替身前统一模块路径格式。
