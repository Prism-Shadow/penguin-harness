# 圆圈「?」悬停即展开说明

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `ui`, `docs`
- **PR:** [#966](https://github.com/Prism-Shadow/penguin-harness/pull/966)

[English](2026-10-03-hover-help.md)

标题旁的圆圈「?」（`InfoPopover`）以前要点击才显示说明，现在悬停即展开；这一行为收进共享 UI 包，以同样方式展开的面板都可复用。

## 变更

- **悬停：** 鼠标停在「?」上，经过与悬停提示相同的延时即展开说明，全站的悬停帮助因此只有一种节奏。离开后稍候收起，指针移进说明面板时保持展开，便于选取文字或点击其中的链接。
- **点击、触屏与键盘：** 点击把面板钉住，直到再点一次、点外部、按 Esc 或滚动页面。触屏上点按即展开，与之前一致。Enter 与 Space 切换展开；单纯聚焦不展开。
- **`useHoverDisclosure`：** 悬停、宽限、钉住与触屏的规则合为 `@prismshadow/penguin-ui` 里的一个 hook，悬停提示的展开延时以 `HOVER_OPEN_DELAY_MS` 导出。`InfoPopover` 建在这个 hook 上；就地展开的 `HelpFold` 仍然点击展开。
- **文档：** 系统设置页写明如何查看并保持「?」的说明。
