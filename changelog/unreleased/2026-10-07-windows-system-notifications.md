# Turning on notifications registers the app with the OS, and the desktop window keeps running in the background

- **Date:** 2026-10-07
- **Type:** fix
- **Scope:** `web`, `desktop`
- **PR:** [#998](https://github.com/Prism-Shadow/penguin-harness/pull/998)
- **Issue:** [#997](https://github.com/Prism-Shadow/penguin-harness/issues/997)

[中文版](2026-10-07-windows-system-notifications.zh.md)

Turning on task-completion notifications in Settings › General now shows a confirmation
notification on the spot, the Windows desktop shell registers its `AppUserModelID` under `HKCU`
on startup, and the desktop window keeps its renderer running at full rate while minimized or
hidden to the system tray.

## Details

- **`enableNotifications` emits a confirmation notice once permission is granted**
  (`packages/web/src/lib/notification-pref.ts`). On Windows (both in Electron and in a browser),
  `Notification.requestPermission()` resolves `"granted"` in memory without touching the OS
  notification centre, and Windows only adds an application to System › Notifications
  (`HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\<AUMID>`) after it has
  actually posted its first toast (`LastNotificationAddedTime`). Showing one immediately registers
  the app on the spot and confirms to the user that notices work.
- **The Windows desktop shell registers its `AppUserModelID` under `HKCU` on startup**
  (`packages/desktop/src/win-aumid.ts`). Writing `DisplayName` and `IconUri` under
  `HKCU\Software\Classes\AppUserModelId\<AUMID>` satisfies Windows' unpackaged toast sender
  contract for both the release (`com.prismshadow.penguinharness`) and dev
  (`com.prismshadow.penguinharness.dev`) profiles, even when no Start Menu shortcut exists or an
  all-users shortcut lacks activator metadata.
- **The desktop main window sets `backgroundThrottling: false`** (`packages/desktop/src/main.ts`),
  so Chromium does not pause timers and SSE delivery while the window is minimized or hidden to the
  system tray — the exact state in which background task-completion notifications need to fire.
