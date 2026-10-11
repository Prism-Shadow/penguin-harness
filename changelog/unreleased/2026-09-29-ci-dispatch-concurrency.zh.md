# 同一 ref 上的两次 CI dispatch 都能跑完

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `ci`

[English](2026-09-29-ci-dispatch-concurrency.md)

手工 dispatch 的每一次 `CI` 运行现在各占一个 concurrency group，同一 ref 上的第二次 dispatch 不再取消第一次。
push 与 pull request 仍按 ref 分组，照旧取消被更新提交取代的那次运行。

## 细节

- `workflow_dispatch` 以 run id 作分组键，其余事件仍以 ref 作分组键；`cancel-in-progress` 不变。
- 聚合门 `ci` 对被取消的运行仍报失败，但在没有任何 job 失败时，会写明「本次运行已被取消」，而不再报
  「有 CI job 未成功」。
