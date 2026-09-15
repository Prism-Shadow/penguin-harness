# 任务完成通知会向系统申请通知权限

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#702](https://github.com/Prism-Shadow/penguin-harness/pull/702)
- **Issue:** [#607](https://github.com/Prism-Shadow/penguin-harness/issues/607)

[English](2026-09-12-notification-permission.md)

Web App 中从未有任何代码调用过 `Notification.requestPermission()`，而任务完成通知又只对桌面壳开放——
Electron 在那里不问自答，把 `Notification.permission` 报成 `"granted"`。那只是 Electron 自己的检查，不是
系统的：在 macOS 上，从不申请授权的 bundle，其通知会被直接丢弃，也永远不会出现在「系统设置 → 通知」里，通知
因此从未弹出过；而真正需要申请权限的浏览器，从一开始就不在这条路径上。

## 细节

- 系统设置 › 个人新增**任务完成通知**开关，默认关闭，按浏览器存为 `penguin.notifications`。
- 打开开关即当场向系统申请通知权限，只有申请结果为已授权时才写入该偏好。被拒绝则开关保持关闭，并给出一行提示
  指向系统自己的通知设置；提示框被直接关掉、没有给出答复（权限停在 `"default"`）时，提示改为说明这一点并请其
  再试一次。平台根本没有 Notification API 时，该行禁用并直接说明。
- 关闭开关即停止通知；系统已经授予的权限保持授予状态。
- 通知不再要求是桌面壳的会话：只要偏好已打开且权限已授予即会弹出，浏览器同样如此；权限在每次任务完成时重新读取，
  期间被收回即停止弹出。桌面壳现在同样要等这个开关：此前通知确实能弹出的桌面安装，也要先打开它才会继续弹。
