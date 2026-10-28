# TRACE 技能库进化工具包

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [Saigyouji-Yuyuko1000/penguin-harness#5](https://github.com/Saigyouji-Yuyuko1000/penguin-harness/pull/5)

[English](2026-10-13-trace-rsi-toolkit.md)

在 Agent 自进化插件与算法目录中新增了 `trace-rsi-toolkit`。

## 训练与测量

汇报统一使用 `baseline`／`final`、测试重复次数、版本、得分及资源字段；各方法的学习记录与 Test 重复测量统计分别保留。

训练进度统一使用编号的 `step` 标签，原算法阶段名称保留用于追溯。

入口 Skill 在容器外组织已发布的连续训练 Benchmark，训练参考文件作为容器内 Curator 的独立 Skill。每批默认每题由新的 Actor 会话尝试两次；Curator 初始化 B0 并演化两轮，全部完成后按 best_train 选版。所选技能库与无 Skill 基线各进行三次完整测试，报告重复实验均分的平均数与样本标准差、各阶段分数、选版依据和资源成本。任务路径与运行契约从当前发布的 Benchmark 解析。

## 部署适配

为 Target 提供了固定的技能库读取指令，并在 Session scratchpad 中记录技能选择。技能选择依赖指令执行，已读取的正文保留在对话历史中。工具包说明了这与论文逐轮替换上下文的区别，区分了选择记录缺失与明确的空选择，并将私有评分材料排除在 Curator 输入之外。
