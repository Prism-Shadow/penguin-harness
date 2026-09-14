# 会话标题滚动展示时不再同时弹出提示气泡

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#706](https://github.com/Prism-Shadow/penguin-harness/pull/706)
- **Issue:** [#570](https://github.com/Prism-Shadow/penguin-harness/issues/570)

[English](2026-09-12-session-title-tooltip.md)

侧边栏中标题长于行宽的会话，鼠标悬停时会被展示两遍：文字把被截断的尾部滚动进视野，同时一个内容相同的
原生提示气泡浮在它上面。现在这类行只保留滚动这一种展示方式。

## 细节

- `Truncated` 仅在尾部无法靠滚动展示时才附加 `title`；未启用滚动展示的调用方，提示气泡与此前完全一致。
- 系统开启「减弱动态效果」时，滚动展示所依赖的关键帧被禁用、文字不再滚动，提示气泡在这种情况下保留，作为
  鼠标悬停时的兜底。
- 涉及的范围是使用滚动展示的两处：侧边栏的会话行与草稿行。
