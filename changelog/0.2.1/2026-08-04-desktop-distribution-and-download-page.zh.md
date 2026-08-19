# 桌面安装包上 OSS 镜像，以及落地页的下载页

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `ci`, `landing`, `docs`
- **PR:** [#177](https://github.com/Prism-Shadow/penguin-harness/pull/177), [#201](https://github.com/Prism-Shadow/penguin-harness/pull/201), [#205](https://github.com/Prism-Shadow/penguin-harness/pull/205)

[English](2026-08-04-desktop-distribution-and-download-page.md)

## 分发

桌面安装包改用不带版本号的产物名，沿用 CLI 安装包的约定——`penguin-desktop-darwin-{arm64,x64}.dmg` / `.zip`、`penguin-desktop-win32-x64.exe`、`penguin-desktop-linux-x86_64.AppImage` / `penguin-desktop-linux-amd64.deb`——版本由 Release tag 与 `SHA256SUMS.desktop` 承载。OSS 镜像任务现在把全部七个安装包连同 `SHA256SUMS.desktop` 一并镜像进不可变的按 tag 前缀之下，并通过 `SHA256SUMS.desktop` 作为整体校验；CLI 安装包的规范清单未变。

## 落地页站点

新增 `/download` 页，采用经典软件下载页的形态：每个平台一张卡片并为访客所用系统加徽标；点击下载按钮起初指向 GitHub 的静态 `releases/latest/download/<name>` 链接，在客户端解析出存储桶的 `latest.json` 指针之后切换为 OSS 镜像的按 tag URL（校验方式与安装脚本转发层校验它的方式完全一致——一次失败的拉取，例如缺少 CORS，会静默保留 GitHub 链接）；另有 GitHub/OSS 源的手动切换、校验和与全部发布的链接，以及未签名构建的首次启动说明。导航（落地页及其文档站对齐副本）、页脚、快速开始提示、站点地图与 Pages 路由外壳都已相应接线，而 README（中英）新增一节桌面应用安装，指向该页面。
