# SkillAdam RSI 工具包

- **Date:** 2026-10-28
- **Type:** feature
- **Scope:** `skills`
- **PR:** [#1374](https://github.com/Prism-Shadow/penguin-harness/pull/1374)

[English](2026-10-28-skilladam-rsi-toolkit.md)

在插件库中加入了 `skilladam-rsi-toolkit`。主控 Penguin 读取 Project 中选定的 Benchmark，组织连续训练，并在保留测试题上评测冻结的 Skill。

## 细节

汇报统一使用 `baseline`／`final`、测试重复次数、版本、得分及资源字段；各方法的学习记录与 Test 重复测量统计分别保留。

训练进度统一使用编号的 `step` 标签，原算法阶段名称保留用于追溯。

插件发布包不包含开发测试文件。

官网算法清单收录 SkillAdam、Evo-Harness、OpenSkill 和 TRACE。

- 添加了初始 Skill 生成、持续更新的问题记录、按方差调整编辑预算和候选评测的训练说明。
- 添加了计算优化器状态及生成评估中心记录的辅助脚本。
- 添加了每组训练一次、默认对每份冻结 State 测试三次的流程说明，分别汇报 Train/Test。每次先汇总全部测试题的得分，再对各次汇总分计算均值与样本标准差；跨 Benchmark 也按相同顺序汇总。
- 必须记录训练前基线与最终 Skill 的 Test 得分。汇报注明实验及组件版本，保留实际训练曲线，并按每份学得的 Skill、每道测试题的每次作答记录费用、时间与 token，分别汇总 Train/Test。Token 分为缓存输入、非缓存输入和输出，同时记录输入合计与总量。
