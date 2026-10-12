# 打开通知时弹出确认通知，Windows 桌面端登记为通知发送方

- **Date:** 2026-10-07
- **Type:** fix
- **Scope:** `web`, `desktop`
- **PR:** [#998](https://github.com/Prism-Shadow/penguin-harness/pull/998)
- **Issue:** [#997](https://github.com/Prism-Shadow/penguin-harness/issues/997)

[English](2026-10-07-windows-system-notifications.md)

在「设置 › 通用」中打开任务完成通知时，新增一条确认通知：系统授予权限后当场弹出，所有平台一致，开关的说明文字也写明了这一点。权限请求被拒绝或被关闭时不弹通知，开关保持关闭，与此前相同。

Windows 桌面端每次启动时都把自己的 AppUserModelID 连同应用的显示名与图标登记到 `HKCU`，开发实例和不经安装程序直接运行的构建因此也能弹出通知。启动不等待这次登记；失败或超过五秒仍未结束的注册表写入记入日志后放弃。
