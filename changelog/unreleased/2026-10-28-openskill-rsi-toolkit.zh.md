# OpenSkill RSI 工具包

- **Date:** 2026-10-28
- **Type:** feature
- **Scope:** `skills`
- **PR:** [Saigyouji-Yuyuko1000/penguin-harness#4](https://github.com/Saigyouji-Yuyuko1000/penguin-harness/pull/4)

[English](2026-10-28-openskill-rsi-toolkit.md)

新增 `openskill-rsi-toolkit`，通过外部检索和独立虚拟验证构建可复用 Skill，冻结技能库后在 Project Benchmark 上评测。

已登记到 core、CLI 和桌面端的包依赖，以及中英文插件目录。

移除开发验收测试和回放工具，以及 Skill 中要求在实验前运行这些检查的规定。

## 实验记录

每个训练单元构建一份技能库，默认对基线和最终 State 各进行三次完整测试。汇报记录实验及组件版本、完整测试重复得分的均值和样本标准差，以及每个训练单元、每次测试作答的实际费用、时间和各类 token。

汇报统一使用 `baseline`／`final`、测试重复次数、版本、得分及资源字段；各方法的学习记录与 Test 重复测量统计分别保留。

训练进度统一使用编号的 `step` 标签，原算法阶段名称保留用于追溯。

OpenSkill 的虚拟验证曲线与 Benchmark Train 得分分开记录。在目标任务评分前结束构建，最终技能库保留最后一次修订。
