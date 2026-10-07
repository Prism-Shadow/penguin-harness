# 开启通知时立即向系统登记应用，且桌面窗口在后台保持全速运行

- **Date:** 2026-10-07
- **Type:** fix
- **Scope:** `web`, `desktop`
- **Issue:** [#997](https://github.com/Prism-Shadow/penguin-harness/issues/997)

[English](2026-10-07-windows-system-notifications.md)

在「设置 › 通用」中打开任务完成通知开关时，现在会当场弹出一条确认通知；Windows 桌面端启动时会将
`AppUserModelID` 写入 `HKCU` 注册表；桌面主窗口在最小化或收进系统托盘期间保持渲染进程全速运行。

## 细节

- **`enableNotifications` 在获得权限后立即发送一条确认通知**
  （`packages/web/src/lib/notification-pref.ts`）。在 Windows 上（无论是 Electron 桌面端还是浏览器），
  `Notification.requestPermission()` 仅在内存里直接返回 `"granted"` 而不会触碰系统通知中心，且
  Windows 只有在应用真正发出第一条 Toast 通知（写入 `LastNotificationAddedTime`）之后，才会将该应用
  收录进「系统 › 通知」列表（`HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\<AUMID>`）。
  当场发出一条确认通知即可立即完成系统通知列表登记，并向用户确认通知链路可用。
- **Windows 桌面外壳在启动时向 `HKCU` 注册 `AppUserModelID`**
  （`packages/desktop/src/win-aumid.ts`）。在 `HKCU\Software\Classes\AppUserModelId\<AUMID>` 下写入
  `DisplayName` 与 `IconUri`，使正式版（`com.prismshadow.penguinharness`）与开发版
  （`com.prismshadow.penguinharness.dev`）即便在缺少开始菜单快捷方式或全用户快捷方式缺少激活器元数据
  时，也能被 Windows `ToastNotificationManager` 正常识别并展示应用名称与图标。
- **桌面主窗口设置 `backgroundThrottling: false`**（`packages/desktop/src/main.ts`），防止窗口最小化
  或关闭收进系统托盘后被 Chromium 节流冻结定时器与 SSE 流，确保后台任务结束时通知能够准时发出。
