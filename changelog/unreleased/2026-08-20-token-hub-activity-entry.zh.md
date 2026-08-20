# Token Hub 活动入口

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`
- **PR:** [#356](https://github.com/Prism-Shadow/penguin-harness/pull/356)

[English](2026-08-20-token-hub-activity-entry.md)

在已登录账号菜单中增加了 Token Hub 活动中心入口，并在独立浏览器标签页中打开。

## 细节

- 入口默认使用 `https://penguin.ooo/activities`。
- 部署时可在 Web App 构建阶段设置 `VITE_TOKEN_HUB_ACTIVITY_URL`，指向其他 Token Hub 域名或某个已生成的活动链接。
- 桌面应用继续通过系统浏览器处理该外部链接。
