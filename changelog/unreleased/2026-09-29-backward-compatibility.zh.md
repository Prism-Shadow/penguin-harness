# 字号设置向后兼容

- **Date:** 2026-09-29
- **Type:** process
- **Scope:** `web`, `ui`
- **PR:** [#892](https://github.com/Prism-Shadow/penguin-harness/pull/892)

[English](2026-09-29-backward-compatibility.md)

[主题切换改动](2026-09-29-theme-switching.zh.md)把按浏览器保存在 `penguin.fontScale` 下的三档字号，换成保存在 `penguin.textSize` 下的五档字号。

## 既有设置

- 已保存的选择按像素延续：`sm`（16px）对应「中」，`md`（18px）对应「大」，`lg`（20px）对应「特大」，选过字号的人看到的字号与之前相同。
- 从未选过字号的浏览器使用新的默认「中」（16px），此前是 18px。
- 旧值在首帧绘制前读取一次，写入新键后删除。无需任何手动操作。

## 移除计划

对 `penguin.fontScale` 的读取——位于首帧前的启动脚本与 `readTextSize`（`@prismshadow/penguin-ui/boot`）中——可在下一个次版本中移除，由准备该版本的发布负责。届时仍未打开过应用的浏览器会从默认字号开始。
