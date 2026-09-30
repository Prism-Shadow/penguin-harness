# 组织内任何人都可以登记 impl PR、执行一次性认领

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `cli`
- **PR:** [Myriad-Dreamin/penguin-harness#124](https://github.com/Myriad-Dreamin/penguin-harness/pull/124)

[English](2026-09-30-proposal-impl-anyone.md)

`penguin org proposal impl <n> <url>`（`PUT …/proposals/:number/impl`）不再对既非作者、也非实现者的员工回 403 `not_author`；`penguin org proposal impl --adopt`（`POST …/proposals/adopt-impl`）不再对员工回 403 `person_required`。两者组织内任何人都可以执行，人或员工均可；组织外的调用者照旧被拒。每条 `impl` 行照旧记下是谁写的（`by`）；已是另一份提案 impl PR 的 PR 照旧回 409 `impl_pr_taken`。
