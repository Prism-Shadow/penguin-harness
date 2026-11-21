# Reflexion 工具包把分数矩阵写成书面反思

- **Date:** 2026-11-14
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`
- **Issue:** [penguin-harness-community #73](https://github.com/Prism-Shadow/penguin-harness-community/issues/73)

[English](2026-11-14-reflexion-rsi-toolkit.md)

新增 `reflexion-rsi-toolkit`，把 [Reflexion](https://arxiv.org/abs/2303.11366) 复现为一套 Agent 试验循环。负责人：[leslie520-bye](https://github.com/leslie520-bye)。

## 运行方式

- Skill 在 Target 的 Agent State 里初始化反思槽：`skills/reflexion-memory/` 存放情景缓存 `reflections.md`，`AGENTS.md` 中一行固定的阅读指令让 Target 在每个任务前读取它。
- 第 1 轮测量基线 State。此后每轮测量结束，Reflector——本会话模型的一个新 `run_subagent` 会话——把分数矩阵与失败用例的公开题面提炼成一条简短的书面反思，追加进缓存；超出缓存容量的最旧条目随之离开。
- 各轮试验通过家族共享的评测参考（与 opro、ape、ace、awm 携带者逐字节一致）在冻结的 Benchmark 上运行，得分最高试验的快照即实验交付物。
- Reflector 永远看不到 Rubric、Trace 或任何用例的答案：声明为论文度量反馈模式的适配，并带有家族的客观性防作弊护栏。

## 打包

插件在 `src/index.ts` 中声明卡片与 Skill（`preinstall: false`），已登记到 server、CLI、桌面端与 landing 打包、中英文插件目录、Skill 文档和官网算法清单。插件带有库内其他 Skill 插件同样运行的 SKILL.md 解析检查。
