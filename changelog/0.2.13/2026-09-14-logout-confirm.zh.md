# 登出前先确认

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `web`
- **PR:** [#724](https://github.com/Prism-Shadow/penguin-harness/pull/724)

[English](2026-09-14-logout-confirm.md)

## 变更内容

- 用户菜单里的**登出**现在会先弹出确认框再结束会话。这一行夹在一串无害的菜单项中间，此前手一滑就直接回到登录页；确认框写明会发生什么（本地会话结束，进行中的对话在服务端继续运行），取消则一切如旧。
