# RRSI 工具包：把一轮进化的两端都正则化

- **Date:** 2026-11-11
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`

[English](2026-11-11-rrsi-rsi-toolkit.md)

新增 RRSI 自进化工具包 `rrsi-rsi-toolkit`，复现《Regularized Recursive Self-Improvement of Agent Harnesses》（Xia 等，2026，[arXiv:2609.24972](https://arxiv.org/abs/2609.24972)）。它是第十个算法工具包，与其余工具包一致：一个与插件同名的 Skill，承载方法与若干聚焦的参考文件，不自带执行器。

## 一轮里被正则化的两端

- Proposer 携带余弦退火的 L0 修改预算：`b_t` 随轮次收缩，早期提案可以捆绑多处独立改动，后期几乎不允许，而停滞会把下一个提案推向此前从未被检验的组件。
- Critic 在花费任何测量之前筛掉候选。它查找的是基准过拟合，也就是改动迎合了带标签的 Train 用例而非任务本身，并且只做接纳或拒绝、不做排序，因此被拒的候选不消耗评测。
- Pruner 把近期最佳增益非正的组件报为删除目标。
- 算法 2 只在候选越过标定噪声下限之后接纳它，落在噪声带内的增益不算增益；同时受 token 成本规则约束，靠更大上下文换来的分数要一并付出代价。

## 打包

插件在 `src/index.ts` 中声明卡片、唯一的 Skill 与图标，`ifaces.json` 由其构建。它已注册进 core、CLI、desktop 与 landing 的打包依赖，进入双语插件目录与官网算法列表，其 Skill 通过所有已发布 Skill 都要通过的前置元数据检查。它的 `references/evaluation.md` 与 ACE、APE、AWM、OPRO 逐字节一致，由 `packages/server/test/plugin-library.test.ts` 的测试钉住。

工具包自成一体：自行创建 Target 智能体的 harness 槽、自行评测每个单元、写入评估中心的记分板，因此无需安装其他插件即可运行。它自带一个冒烟演示任务与其 Benchmark，可在选定真实 Benchmark 之前先把一轮完整跑通。
