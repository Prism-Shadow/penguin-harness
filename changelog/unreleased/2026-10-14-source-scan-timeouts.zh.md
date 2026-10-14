# 加快 JSX 源码检查

- **Date:** 2026-10-14
- **Type:** process
- **Scope:** `web`, `ci`
- **PR:** [#1129](https://github.com/Prism-Shadow/penguin-harness/pull/1129)

[English](2026-10-14-source-scan-timeouts.md)

减少了控件尺寸、提示锚点、通知图标和必填标记检查中不必要的 TypeScript 解析。在解析前跳过不含相关组件名称或样式的文件，包含转义样式字面量的文件仍接受完整的 JSX 检查。

将控件尺寸和提示锚点的测试样例改为调用仓库检查所用的扫描函数，并补充了转义样式、仅在注释中提及组件或样式、页脚按钮尺寸等场景。
