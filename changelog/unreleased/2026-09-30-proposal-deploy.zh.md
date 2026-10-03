# 提案用组织自己登记的部署脚本部署

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `cli`, `web`

[English](2026-09-30-proposal-deploy.md)

组织用 `penguin org proposal deploy-script add <id> [--description <text>] -- <command> [args...]` 登记部署脚本（仅服务器管理员；`deploy-script ls` 与 `deploy-script rm <id>` 用于列出与移除）。登记表是组织目录下的 `deploy-scripts.json`。

`penguin org proposal deploy <n> --to <id> [--dry-run] [-- <extra args...>]` 对提案 `n` 的 impl PR 的 head 运行脚本 `<id>`。脚本在持有本组织的服务器上、在组织的共享工作区里运行，额外参数接在登记的命令之后，PR 经环境变量传入：`PENGUIN_DEPLOY_HEAD`、`PENGUIN_DEPLOY_REPO`、`PENGUIN_DEPLOY_PR`、`PENGUIN_DEPLOY_PR_URL`、`PENGUIN_DEPLOY_BRANCH`、`PENGUIN_DEPLOY_PROPOSAL`、`PENGUIN_DEPLOY_ID`、`PENGUIN_DEPLOY_RUN` 与 `PENGUIN_DEPLOY_BY`。命令跟随运行的输出，脚本以 0 退出时它才以 0 退出；`--dry-run` 只打印将要运行的命令与 head，不运行。

在 PR 关系图页上右键一个节点（或点它的省略号）会列出部署脚本；选一个后填写额外参数，即对这张 PR 的 head 运行该脚本并显示输出。关系图读取之后 head 已经变化的，服务器拒绝。

同一个脚本同一时间只运行一次，超过一小时即停止。运行记录与输出的最后 1 MiB 只保存在内存里，重启后不再保留。
