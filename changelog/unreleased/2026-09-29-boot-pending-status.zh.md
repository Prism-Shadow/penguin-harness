# Web App：还在确认登录的页面会说明在加载，不再一片黑

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `web`
- **PR:** [Myriad-Dreamin/penguin-harness#105](https://github.com/Myriad-Dreamin/penguin-harness/pull/105)

[English](2026-09-29-boot-pending-status.md)

每次打开页面都要经过一段屏幕上什么也没有的时间：应用已经挂载，但 `GET /api/me` 还没返回时登录守卫什么都不渲染，深色主题下露出的就是纯黑的页面底色。链路慢时这段会持续数秒、每一页都有，看起来像应用挂了。现在这段等待里守卫会在正中显示「加载中…」。

## Details

- 两个登录守卫（应用外壳的那个，以及 `/terminal` 与整页 Workflow 用的裸守卫）都改为渲染这条状态，不再返回 `null`。
- 它在 400 ms 之后才淡入，快的加载会直接进入页面、不会闪一下文字；开启「减少动态效果」时直接显示。它是一个 `role="status"` 区域，屏幕阅读器会播报。
- 样式表与脚本到达之前的那一帧白底不在本次改动之内。
