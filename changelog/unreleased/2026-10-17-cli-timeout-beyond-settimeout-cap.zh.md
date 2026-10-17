# 超过 setTimeout 上限的等待不再立刻结束

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1180](https://github.com/Prism-Shadow/penguin-harness/pull/1180)

[English](2026-10-17-cli-timeout-beyond-settimeout-cap.md)

`run --timeout`、`input --timeout` 和 `logs -f --timeout` 在等待预算折算超过 2^31-1 毫秒（约 596 小时）时原本会立刻结束——打印转后台提示并以 0 退出：`nextFrameOrDeadline` 把整个剩余等待交给单个 `setTimeout`，而 Node 会把这种延迟钳到 1。现在定时器保持在略低于上限、到点重设，直到期限真正到来，解析器接受的任何预算都会等足所声明的时长。

## 细节

- 由 `packages/cli/test/server-task-timeout.test.ts` 覆盖，该测试在单定时器版本上失败。
