# 发布流程重新把 Docker 镜像发布到版本号标签下

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `ci`
- **PR:** PR_PLACEHOLDER

[English](2026-09-10-docker-release-tag.md)

`docker.yml` 现在以 `tag` 输入是否存在来区分发布构建和 `main` 的推送构建，而不再看事件名。发布工作流
以 `workflow_call` 调用它时沿用调用方的事件，tag 推送的事件名同样是 `push`，于是 v0.2.10 与 v0.2.11 的
发布构建都推到了 `latest`，没有发布 `X.Y.Z` 标签。这两个版本随后通过带 tag 手动触发该工作流补发（这条
路径一直是对的）；自此发布会在第一次运行时就落到精确的版本号标签上。
