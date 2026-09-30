# `penguin org proposal deploy` 把一台 server 推到某份提案那一代

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `cli`, `plugins`

[English](2026-09-30-proposal-deploy.md)

`penguin org proposal deploy <n> --to <port|url>` 把一台 penguin server 热更新到提案 `n` 的 impl PR 的 head。它在本仓库的检出里运行：从 PR 所在仓库取回 `refs/pull/<PR>/head`，在 `.worktrees/` 下的临时 worktree 里跑 `pnpm install --frozen-lockfile` 与 `pnpm -r build`，再跑那一代自己的 `scripts/deploy.mjs <target>`，最后删掉 worktree。之后读目标的 `GET /api/version`，`harness.source.revision` 指向该 head 才算成功；目标拒收或回滚时命令失败，并打印期望与实际两个 revision。`--dry-run` 只解析并取回 head，不推送。

目标的凭据取自环境变量，与 `deploy.mjs` 相同：`PENGUIN_ADMIN_PASSWORD` 或 `PENGUIN_API_TOKEN`；命令不保存、也不打印任何凭据。提案没有 impl PR、impl PR 不是 GitHub pull request、目标是本机之外的明文 `http://` 时，命令在执行任何步骤之前就拒绝。
