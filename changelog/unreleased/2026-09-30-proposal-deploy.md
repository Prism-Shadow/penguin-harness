# Proposals deploy with the organization's own deploy scripts

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `cli`, `web`

[中文版](2026-09-30-proposal-deploy.zh.md)

An organization registers its deploy scripts with `penguin org proposal deploy-script add <id> [--description <text>] -- <command> [args...]` (a server admin only; `deploy-script ls` and `deploy-script rm <id>` list and remove them). The registry is `deploy-scripts.json` in the organization's directory.

`penguin org proposal deploy <n> --to <id> [--dry-run] [-- <extra args...>]` runs script `<id>` on the head of proposal `n`'s impl PR. The script runs on the server that holds the organization, in its shared workspace, with the extra arguments appended to the registered command and the PR in its environment: `PENGUIN_DEPLOY_HEAD`, `PENGUIN_DEPLOY_REPO`, `PENGUIN_DEPLOY_PR`, `PENGUIN_DEPLOY_PR_URL`, `PENGUIN_DEPLOY_BRANCH`, `PENGUIN_DEPLOY_PROPOSAL`, `PENGUIN_DEPLOY_ID`, `PENGUIN_DEPLOY_RUN` and `PENGUIN_DEPLOY_BY`. The command follows the run's output and exits 0 only when the script did; `--dry-run` prints the command and the head without running anything.

On the PR graph page, right-clicking a node (or its ellipsis) lists the deploy scripts; picking one asks for extra arguments, runs the script on that PR's head and shows its output. A head that moved since the graph was read is refused.

One run per script at a time, stopped after an hour. Runs and the last MiB of their output are kept in memory and are gone after a restart.
