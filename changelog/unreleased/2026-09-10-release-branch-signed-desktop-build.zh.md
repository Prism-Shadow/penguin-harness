# 发布分支在打 tag 之前先构建签名安装包

- **Date:** 2026-09-10
- **Type:** ci
- **Scope:** `ci`, `desktop`
- **PR:** PR_PLACEHOLDER

[English](2026-09-10-release-branch-signed-desktop-build.md)

`desktop-build.yml` 现在也会在每次推送到 `release/**` 分支时运行，并要求 macOS 与 Windows 签名，
与发布流程调用它的方式完全一致。是否要求签名改为在工作流层面根据事件和输入一次判定，各步骤读取该
判定而不再读取推送事件下为空的输入。这条路径上的版本戳保持开发版本，发布版本由 tag 自己的那次运行盖上。

CI 从不演练签名，而签名既取决于仓库也取决于托管运行器镜像：0.2.10 在 CI 全绿的情况下打了 tag，
却因两天前更新的 `macos-26` 镜像丢掉了 macOS 安装包，代码只得以 0.2.11 重新发布。发布分支现在会在
tag 出现之前，就在最终 commit 上证明它的安装包能出来。
