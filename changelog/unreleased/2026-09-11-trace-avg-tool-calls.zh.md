# Trace 全局统计改用每轮平均工具调用，取代压缩次数

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `web`
- **PR:** [#681](https://github.com/Prism-Shadow/penguin-harness/pull/681)

[English](2026-09-11-trace-avg-tool-calls.md)

Trace 页的全局统计把压缩次数换成了每轮平均工具调用。平均值就是它正上方两项相除，工具调用 ÷ 轮次，一眼
即可核对，并且沿用该列的口径：轮次指下方的每一张卡片，含压缩轮。轮次为 0 的 Trace 上平均值无定义，显示
`—`，与成本、TPS 在数值不可用时的标记一致。

改动只落在 Web App：服务端返回的 Trace 分析保留 `compactionCount` 字段，只是不再被渲染。
