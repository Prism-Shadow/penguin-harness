# `penguin org proposal deploy` puts a server on a proposal's generation

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `cli`, `plugins`

[中文版](2026-09-30-proposal-deploy.zh.md)

`penguin org proposal deploy <n> --to <port|url>` hot-updates one penguin server to the head of proposal `n`'s impl PR. Run from inside a checkout of this repository, it fetches `refs/pull/<PR>/head` from the PR's repository, runs `pnpm install --frozen-lockfile` and `pnpm -r build` in a throwaway worktree under `.worktrees/`, runs that generation's own `scripts/deploy.mjs <target>`, and removes the worktree. It then reads the target's `GET /api/version` and succeeds only when `harness.source.revision` names the head; a refused or rolled-back push fails with both revisions printed. `--dry-run` resolves and fetches the head and pushes nothing.

The target's credential comes from the environment, `PENGUIN_ADMIN_PASSWORD` or `PENGUIN_API_TOKEN` as `deploy.mjs` takes them; the command stores none and prints none. A proposal without an impl PR, an impl PR that is not a GitHub pull request, and a plaintext `http://` target off this machine are refused before anything runs.
