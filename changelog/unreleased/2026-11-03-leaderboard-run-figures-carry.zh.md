# 榜单的运行时长和 Token 数进到下一个单位

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1449](https://github.com/Prism-Shadow/penguin-harness/pull/1449)

[English](2026-11-03-leaderboard-run-figures-carry.md)

榜单页不再用一个装不下四舍五入结果的单位显示运行时长和 Token 数。时长原先按原始数值选分钟，再四舍五入，所以 59.6 分钟的运行显示为 `60 min`。Token 数也一样，999,500 显示为 `1000K`，99,960 显示为 `100.0K`。现在分别显示为 `1.0 h`、`1.0M` 和 `100K`。`formatDuration` 从 `score-table.tsx` 移到 `src/lib/hub/text.ts`，和其他榜单格式放在一起。
