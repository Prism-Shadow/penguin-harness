# 桌面端演练构建不要求签名就不签名

- **Date:** 2026-10-22
- **Type:** process
- **Scope:** `ci`, `desktop`
- **PR:** [#1296](https://github.com/Prism-Shadow/penguin-harness/pull/1296)

[English](2026-10-22-unsigned-dry-run.md)

`desktop-build.yml` 只在要求 Windows 签名时——发布、推送到 `release/**` 分支，或以
`require_windows_signing=true` 手动触发——才把 EVSign 密钥交给 Windows 构建并下载 EVSign 客户端。
不带该输入的手动触发即使 `desktop-build` 环境里存有密钥，也产出未签名的 Windows 安装包，与 macOS、
Linux 一致；此前这类演练会给每次 Windows 构建做 EV 签名。

每个构建任务把产物是否签名写入运行摘要。Windows 产物校验在演练中照常运行：接受未签名文件，仍核对更新
元数据与最终安装包字节是否一致，签名存在但无效仍然失败。要求签名的构建在缺少密钥或签名无效时照旧失败。
