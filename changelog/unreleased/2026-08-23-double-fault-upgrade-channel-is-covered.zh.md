# 二次故障这条路现在有测试覆盖

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `server`
- **PR:** [#425](https://github.com/Prism-Shadow/penguin-harness/pull/425)

[English](2026-08-23-double-fault-upgrade-channel-is-covered.md)

启动失败的恢复用重启「原本在运行的版本」来
[回应一个启动不了的推送](2026-08-20-hot-update-failure-modes.zh.md)。而这次重启本身也失败时会发生
什么，只在代码处写着——告警、让 `/api/hmr` 仍可接收后续推送、重启时恢复已提交的版本——却没有任何
断言：恢复相关的测试全都停在第一次故障。

现在测试会把第二次故障也走一遍，用的是一个只肯启动一次、之后拒绝任何启动的 platform。

## 细节

- 恢复同样失败的失败推送，返回的是被推送 bundle 自己的启动错误，把恢复失败写进机器自己的日志，并把
  已 dispose 的实例留在原处。
- 在这个状态上推送一个好的版本能落地并开始服务，无需重启。
- 在这个状态上重启，会恢复 `harness.json` 记录的那个版本。
