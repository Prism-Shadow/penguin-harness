# 任务完成通知会向系统申请通知权限

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#702](https://github.com/Prism-Shadow/penguin-harness/pull/702)
- **Issue:** [#607](https://github.com/Prism-Shadow/penguin-harness/issues/607)

[English](2026-09-12-notification-permission.md)

Web App 中从未有任何代码调用过 `Notification.requestPermission()`，浏览器侧的通知权限因此一直停在
`"default"`，任务完成通知的 `permission === "granted"` 判定永不通过，通知也就从未弹出过。在 macOS 上，
该应用甚至不会出现在「系统设置 → 通知」里——系统从未收到过它的申请。

## 细节

- 系统设置 › 个人新增**任务完成通知**开关，默认关闭，按浏览器存为 `penguin.notifications`。
- 打开开关即当场向系统申请通知权限，只有申请结果为已授权时才写入该偏好。被拒绝——或提示框被忽略、答案停在
  `"default"`——则开关保持关闭，并给出一行提示指向系统自己的通知设置。平台根本没有 Notification API 时，该
  行禁用并直接说明。
- 关闭开关即停止通知；系统已经授予的权限保持授予状态。
- 通知不再要求是桌面壳的会话：只要偏好已打开且权限已授予即会弹出，浏览器同样如此；权限在每次任务完成时重新读取，
  期间被收回即停止弹出。
