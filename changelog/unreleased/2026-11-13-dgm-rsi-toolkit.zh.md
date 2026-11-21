# DGM 工具包从自身变体的档案中进化编码智能体

- **Date:** 2026-11-13
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`
- **Issue:** [penguin-harness-community #72](https://github.com/Prism-Shadow/penguin-harness-community/issues/72)

[English](2026-11-13-dgm-rsi-toolkit.md)

新增 `dgm-rsi-toolkit`，按照 [Darwin Gödel Machine](https://arxiv.org/abs/2505.22954)（Sakana AI，2025）的方式改进 Target Agent：维护编码智能体变体的档案，并让新的子智能体会话修改 Target 的 Skill 文件。负责人：[leslie520-bye](https://github.com/leslie520-bye)。

## 运行方式

- Skill 创建 Target Agent 的学习槽位，并把刚初始化的 Target 播种进档案：基线智能体在任何修改之前先入档。
- 每轮按得分与多样性从档案中选择父代，每个子代由一个全新的 `run_subagent` 会话改写父代的 Skill 文件。每个候选都在冻结的 Benchmark 上测量；档案只收录实测过的子代。
- 两轮、每轮一个子代，足以完整看到循环全程：报告给出基线分、最佳分与档案树，每个结论都能回溯到一次 Benchmark 运行。
- 档案而非工作副本是唯一事实来源：任何未经测量的子代都不会写进 Target 的 Skill 文件。

## 打包

插件在 `src/index.ts` 中声明卡片与 Skill（`preinstall: false`），已登记到 server、CLI、桌面端与 landing 打包、中英文插件目录、Skill 文档和官网算法清单。插件带有库内其他 Skill 插件同样运行的 SKILL.md 解析检查。
