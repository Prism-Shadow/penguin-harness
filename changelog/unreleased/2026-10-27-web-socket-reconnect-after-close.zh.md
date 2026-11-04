# 流都已关闭时，API socket 不再为它们重连

- **Date:** 2026-10-27
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1370](https://github.com/Prism-Shadow/penguin-harness/pull/1370)

[English](2026-10-27-web-socket-reconnect-after-close.md)

Web App 的 API socket 断开后会预约一次重连，把挂起的流接回来。现在这些流中的最后一条关闭时，这次重连随之取消：socket 断开期间卸载的页面，离开后不会再去确认登录身份，也不会再打开 socket。下一条流打开时会自行重新建立 socket。
