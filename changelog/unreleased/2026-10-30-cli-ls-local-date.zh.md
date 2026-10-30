# `session ls` 按本地日历标注较早的行

- **Date:** 2026-10-30
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1409](https://github.com/Prism-Shadow/penguin-harness/pull/1409)

[English](2026-10-30-cli-ls-local-date.md)

`penguin session ls` 的 LAST 列对超过两周的行显示的是 UTC 日期，而 `--days` 按本地日历日计数。在 UTC+8 下，零点到 08:00 之间最后活跃的 Session 会显示成前一天，这个日期可能落在 `--days` 刚把它算进去的窗口之外。该列现在显示读者自己的日历日，与 Web App 的会话列表一致。

## 细节

- `packages/cli/src/table.ts` 里的 `relativeTime` 改用本地的年、月、日拼出日期，不再截取时间戳的 UTC 日期部分。`now`、`5m`、`3h`、`2d` 这些短格式不变。
