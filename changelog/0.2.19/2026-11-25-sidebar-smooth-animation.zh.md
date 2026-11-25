# 侧边栏与折叠区空间分配与滑动动画同步化

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1845](https://github.com/Prism-Shadow/penguin-harness/pull/1845)

[English](2026-11-25-sidebar-smooth-animation.md)

修复打开侧边栏/底部面板与折叠分组时「先瞬间分配高度/宽度留白、随后内容再滑入」的两段式跳变，使外层空间分配、分隔线位移与内容滑动在同一柔滑缓动曲线下同步完成。
