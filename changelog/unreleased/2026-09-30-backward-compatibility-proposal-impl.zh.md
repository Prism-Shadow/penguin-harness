# 向后兼容：impl PR 出现之前写下的提案账本

- **Date:** 2026-09-30
- **Type:** process
- **Scope:** `plugins`, `cli`
- **PR:** [Myriad-Dreamin/penguin-harness#108](https://github.com/Myriad-Dreamin/penguin-harness/pull/108)

[English](2026-09-30-backward-compatibility-proposal-impl.md)

## 没有 impl PR 的提案由人一次性认领

impl PR 出现之前写下的 `proposals.jsonl` 里没有 `impl` 行。这些提案载入后没有 impl PR，关系图上它们的 PR 显示为「无提案」。载入时不会从 `pr` 材料里读取任何东西。

设好交付仓库之后，由人在每个组织里执行一次 `penguin org proposal impl --adopt`（`POST …/proposals/adopt-impl`）。每份没有 impl PR、也没被拒绝的提案，都取它在交付仓库上最新的一条 `pr` 材料作为 impl PR。每次认领都是一条普通的 `impl` 行，记在执行者名下。返回结果会列出两类提案：有多条这类材料、因此取了最新一条的；以及因为没有这类材料、或那张 PR 已属于另一份提案而被跳过的。第一次之后再执行，不会认领任何新东西。认领错了，用 `penguin org proposal impl <n> <url>` 改正。

范围：运行本插件的服务器上，每个组织的 `<orgDir>/proposals.jsonl`。需要人动手：管理员设好**交付仓库**之后，由人执行一次认领。

## 兼容性

认领（`adoptImpl`、它的路由和 `impl --adopt`）是一次性迁移代码。它会保留到每个在本改动之前已有提案的组织都执行过一次为止。提案插件的维护者在下一次发布准备时检查，届时移除。移除之后，仍没有 impl PR 的提案需要手工登记。
