# CI 与站点构建只为 main 触发

- **Date:** 2026-09-15
- **Type:** process
- **Scope:** `ci`
- **PR:** [#731](https://github.com/Prism-Shadow/penguin-harness/pull/731)

[English](2026-09-15-ci-main-only-triggers.md)

## 变更内容

- CI 工作流只在推送到 `main`、以及目标分支为 `main` 的 pull request 时运行，其余一概不触发：`dev` 的推送触发去掉了，目标是别的分支的 pull request（堆叠的 PR、集成分支）在改为以 `main` 为目标之前不再起跑（手动 dispatch 仍可用）。一次运行是共享 runner 池上的 21 个 job，队列就是这么堆起来的。
- pages 与 Docker 工作流的 pull request 触发加上同样的目标分支过滤，叠在各自原有的路径过滤之上；两者的推送触发本来就只有 `main`。
