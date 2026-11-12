# RRSI 工具包：把一轮进化的两端都正则化

- **Date:** 2026-11-11
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`
- **PR:** [#1535](https://github.com/Prism-Shadow/penguin-harness/pull/1535)

[English](2026-11-11-rrsi-rsi-toolkit.md)

新增 RRSI 自进化工具包 `rrsi-rsi-toolkit`，复现《Regularized Recursive Self-Improvement of Agent Harnesses》（Xia 等，2026，[arXiv:2609.24972](https://arxiv.org/abs/2609.24972)）。它是第十个算法工具包，与其余工具包一致：一个与插件同名的 Skill，承载方法与若干聚焦的参考文件，不自带执行器。

## 一轮里被正则化的两端

- Proposer 携带余弦退火的 L0 修改预算：`b_t` 随轮次收缩，早期提案可以捆绑多处独立改动，后期几乎不允许，而停滞会把下一个提案推向此前从未被检验的组件。
- Critic 在花费任何测量之前筛掉候选。它查找的是基准过拟合，也就是改动迎合了带标签的 Train 用例而非任务本身，并且只做接纳或拒绝、不做排序，因此被拒的候选不消耗评测。
- Pruner 把近期最佳增益非正的组件报为删除目标。
- 算法 2 根据标定得分下限、policy-token 成本与结构新颖性选择候选，并保留最后接受的 harness 用于留出测试。
- 校准采用原作者的重复基线估计和合并 trial 的 bootstrap 回退，使用与候选评测相同的每题重复次数。
- 评测分别记录 policy tokens 与美元费用，并采用上游的 Token 缺失处理约定。

## 可修改的 harness

工具包支持修改目标 Agent State，也支持修改目标源码的独立副本。每个已测版本保留 State 快照和源码构建记录；源码模式的评测使用候选对应的 CLI 或安装包。Proposer 通过 Penguin 原生工具修改文件，以 JSON 返回修改声明。

## 打包

插件在 `src/index.ts` 中声明卡片、唯一的 Skill 与图标，并编译为 `ifaces.json`。它已注册进 server、CLI、desktop 与 landing 的打包依赖，进入双语插件目录与官网算法列表。其评测说明补充了 Token 用量和源码构建绑定；公共评测文件的一致性检查保留在 ACE、APE、AWM、OPRO 上。

工具包自成一体：自行创建 Target 智能体的 harness 槽、自行评测每个单元、写入评估中心的记分板，因此无需安装其他插件即可运行。它自带一个冒烟演示任务与其 Benchmark，可在选定真实 Benchmark 之前先把一轮完整跑通。
