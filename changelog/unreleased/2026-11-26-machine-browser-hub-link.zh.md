# 机器经添加它的服务端打开的通道，使用人自己的浏览器

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `browser-automation`

[English](2026-11-26-machine-browser-hub-link.md)

机器上的浏览器模块现在接受添加它的服务端（本服务端）打开的通道 `WS /api/builtin-browser/hub/ws`：本服务端经这条通道把人自己的浏览器——桌面端的内置浏览器，或管理员配对的 Chrome——转给机器。机器上的 Agent 照旧在本机运行驱动、页面脚本与各类操作，发出的每条命令经通道到本服务端，由它在那个浏览器里执行。通道的本服务端一侧在下一项改动中提供；在此之前没有本服务端连入，机器照旧答 `hub_disconnected`。

## 通道

- 端点只认本服务端在机器上铸造的管理员会话，拒绝带 `Origin` 的握手（网页）、成员，以及在桌面应用里运行的服务端。
- 收发扩展同一套 `desktop-browser-*` 协议：机器先发 `hello`、每 20 秒 `ping`，后连者替代先连者；本服务端答 `{ version: 1, backend, hub: true }`，机器的状态即报这个后端。
- `open-tab` 另带机器上的 Session 与其 Project；本服务端打开的标签页归该 Session，Agent 只看得到自己 Session 的标签页。
- 新增命令 `activity`，在 Agent 的操作开始与结束时告知本服务端。
- 机器上读写人的 Cookie 或存储的原始 CDP 在发出前即被拒绝（`403 cdp_refused`），与用户自己的 Chrome 相同。
- 没有以机器方式启动、也不在桌面应用里的服务端，有本服务端连入后对其管理员成为机器，其成员保留自己的 Chrome；机器的应用中心经通道统计与关闭其 Session 的页面。
