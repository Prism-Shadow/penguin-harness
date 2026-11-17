# CLI：`relativeTime` 将未来时间戳格式化为本地日期而非 `"now"`

- **Date:** 2026-11-17
- **Type:** fix
- **Scope:** `server`, `cli`
- **PR:** [#1601](https://github.com/Prism-Shadow/penguin-harness/pull/1601)

[English](2026-11-17-fix-cli-relative-time-future.md)

当会话时间戳领先于本机时钟时，`packages/server/src/cli/table.ts` 中的 `relativeTime` 会算出负数秒数并落入 `< 60` 秒分支，错误地输出 `"now"`；而 Web 端的孪生函数 `formatRelativeShort` 已会将未来时间戳显示为本地日期。

## 细节

- `relativeTime` 现在在 `"now"` 分支之前判断 `seconds < 0`，并以调用者本地时区通过 `formatLocalDate` 格式化未来时间戳。
- 在 `packages/server/test/cli/table.test.ts` 中补充了跨东西时区的未来时间戳与单位边界单测，并在 `packages/cli/test/server-commands.test.ts` 中增加了 `penguin session ls` 的集成验证。
