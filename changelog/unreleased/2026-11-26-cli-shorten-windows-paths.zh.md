# CLI 工具调用预览中的 Windows 路径缩短

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1888](https://github.com/Prism-Shadow/penguin-harness/pull/1888)

[English](2026-11-26-cli-shorten-windows-paths.md)

更新了 CLI 文件工具调用预览（`read_file`、`edit_file`、`write_file`），将较深的 Windows 反斜杠路径和混合分隔符路径缩短为最后两级路径段。

## 细节

- 在缩短 CLI 工具调用预览中的文件路径时同时按 `/` 和 `\` 分段：纯反斜杠的 Windows 路径和 UNC 路径保留 `\` 作为输出分隔符，包含正斜杠的路径使用 `/`。
- 保持两段以内的 Windows 路径（如 `src\file.ts`、`C:\file.ts`）原样显示。
