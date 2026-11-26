# 多行提示条的圆点停在第一行

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `ui`
- **PR:** [#1897](https://github.com/Prism-Shadow/penguin-harness/pull/1897)

[English](2026-11-26-notice-dot-first-line.md)

## 细节

- 共用的 `Notice` 现在让状态标记停在第一行文字旁，不再相对整个提示条垂直居中；换行或带标题的提示条（如插件市场展开后的来源失败提示）不会再让标记停在中间某一行旁。Frost、Console 与 Doodle 主题用 CSS 绘制该标记，现改为锚定到提示条的前导块（`ui-notice` 新增的 `lead` 槽位）；GitHub 主题的真实图标同样落在第一行。单行提示条（无论是否带按钮）外观不变。
- UI 画廊的 Notice 板新增一个多行示例。
