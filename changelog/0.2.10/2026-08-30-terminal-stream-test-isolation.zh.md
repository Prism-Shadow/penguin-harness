# 终端流测试套件在下一条测试开始前杀掉上一条的 shell

- **Date:** 2026-08-30
- **Type:** process
- **Scope:** `server`, `tooling`
- **PR:** [#558](https://github.com/Prism-Shadow/penguin-harness/pull/558)

[English](2026-08-30-terminal-stream-test-isolation.md)

`terminal-stream.test.ts` 的所有测试共用一个 app,一共开了十四个没人关闭的 `/bin/sh`,而注册表限制每个用户最多十二个存活 shell。只有当前面足够多的 shell 恰好自行退出时才装得下,于是它在一台 runner 上通过、在更慢的一台上答 `429`。现在每条测试结束后删除它的终端,下一条测试等注册表报告没有存活的再开始。
