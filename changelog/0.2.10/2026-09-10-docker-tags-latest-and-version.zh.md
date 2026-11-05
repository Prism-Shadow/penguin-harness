# 镜像只发布两种 tag：main 的 `latest` 与发布版的精确版本号

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `ci`, `docs`
- **PR:** [#660](https://github.com/Prism-Shadow/penguin-harness/pull/660)

[English](2026-09-10-docker-tags-latest-and-version.md)

Docker 工作流不再在 push main 时发布 `main-<sha7>` 副本，也不再在发版时发布 `X.Y` 与 `stable`。push `main` 只移动 `latest`；发版只发布精确版本号 `X.Y.Z`。镜像内部仍以 `main-<sha7>` 或版本号作为其上报的版本。

## 细节

- `.github/workflows/docker.yml`：版本步骤只解析一个 tag——push 为 `latest`，发版为该 tag 的版本号——移动 `stable` 所依赖的「最新 Release」查询随之删除。
- 文档（`quickstart-docker`）、贡献指南与设计文档的交付渠道说明改为描述这两种 tag；Docker Hub 上已出现的 `main-*` 与 `0.2` 需手工删除——工作流只会新增 tag，发布用的 token 也没有删除权限。
