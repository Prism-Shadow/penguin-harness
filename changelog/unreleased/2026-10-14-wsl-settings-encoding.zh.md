# 修复设置中的 WSL 提示乱码

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `sandbox-wsl`
- **PR:** [#1125](https://github.com/Prism-Shadow/penguin-harness/pull/1125)

[English](2026-10-14-wsl-settings-encoding.md)

修复了「设置 → 插件」中 WSL 中文诊断信息的乱码。WSL 命令输出和安装日志在显示前按 UTF-8 或 UTF-16LE 解码。
