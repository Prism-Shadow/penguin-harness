# Task-completion notifications ask the system for permission

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `web`
- **Issue:** [#607](https://github.com/Prism-Shadow/penguin-harness/issues/607)

[中文版](2026-09-12-notification-permission.zh.md)

Nothing in the Web App ever called `Notification.requestPermission()`, so the browser
permission stayed at `"default"`, the completion notification's `permission === "granted"`
gate never opened, and no notification was ever shown. On macOS the app did not even appear
in System Settings → Notifications, because the system had never been asked by it.

## Details

- System settings › General gained a **Task completion notifications** switch, off by
  default and stored per browser as `penguin.notifications`.
- Turning the switch on asks the system for permission at that moment, and the preference is
  stored only if that request comes back granted. A denial — or a dismissed prompt, which
  leaves the answer at `"default"` — keeps the switch off and shows a hint pointing at the
  system's own notification settings. Where the platform has no Notification API at all, the
  row is disabled and says so.
- Turning the switch off stops the notifications; the permission the system granted stays
  granted.
- The notification no longer requires a desktop-shell session. It is shown wherever the
  preference is on and the permission is granted, a browser included, and the permission is
  re-read on every completion so a permission revoked in the meantime stops it.
