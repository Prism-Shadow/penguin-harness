# 用星标标出不被收起的侧栏入口与模型分组

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `ui`, `web`, `docs`
- **PR:** [#966](https://github.com/Prism-Shadow/penguin-harness/pull/966)

[English](2026-10-03-favorites-star.md)

让侧栏入口或模型分组不进收起区的开关改为「收藏」：原先的锁形图标读起来像权限或加密，产品负责人要求换成星标。

## 变更

- **图标：** 侧栏导航入口与模型分组标题栏改画星标，可收起时为空心星，收藏后为实心星。新增的 `star` 图标在每套主题的图标集里都有自己的画法（线性路径、Octicons 的 `star` / `star-fill`、16×16 像素星与琥珀色双色调）；`lock` 与 `lockOpen` 再无他用，已从图标表中移除。
- **文案：** 两处开关的「常驻 / 取消常驻」改为「收藏 / 取消收藏」，英文由 "Pin" / "Unpin" 改为 "Add to favorites" / "Remove from favorites"。开关的作用与已存的选择都不变：收藏的始终显示，其余收进收起区。
- **文档：** Web App 与模型库页面改为描述星标。
