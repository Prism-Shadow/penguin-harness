# SVG 预览尺寸与精简的文件回复

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `ui`, `core`
- **PR:** [#1130](https://github.com/Prism-Shadow/penguin-harness/pull/1130)

[English](2026-10-14-svg-preview-prompt.md)

修复了只有 `viewBox`、没有固定宽高的 SVG 在图片预览中缩成小点的问题。放大预览会保持图片比例并适配窗口大小。

默认提示词改为提供文件路径，除非用户要求，否则不重复文件中的代码。复用框架及使用 CLI 创建项目的建议与 React 偏好分开表达，并删除了重复的库可用性说明。
