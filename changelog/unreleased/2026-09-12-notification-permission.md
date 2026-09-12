# Task-completion notifications ask the system for permission

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#702](https://github.com/Prism-Shadow/penguin-harness/pull/702)
- **Issue:** [#607](https://github.com/Prism-Shadow/penguin-harness/issues/607)

[中文版](2026-09-12-notification-permission.zh.md)

Nothing in the Web App ever called `Notification.requestPermission()`, and the completion
notification was gated to the desktop shell, where Electron reports `Notification.permission`
as `"granted"` without asking anyone. That is Electron's own check rather than the system's:
on macOS a bundle that never requests authorization has its notifications dropped and never
appears in System Settings → Notifications, so nothing was ever shown there — and a browser,
which would have had to be asked, was not eligible in the first place.

## Details

- System settings › General gained a **Task completion notifications** switch, off by
  default and stored per browser as `penguin.notifications`.
- Turning the switch on asks the system for permission at that moment, and the preference is
  stored only if that request comes back granted. A denial keeps the switch off and shows a
  hint pointing at the system's own notification settings; a prompt closed without an answer,
  which leaves the permission at `"default"`, says that instead and invites another try.
  Where the platform has no Notification API at all, the row is disabled and says so.
- Turning the switch off stops the notifications; the permission the system granted stays
  granted.
- The notification no longer requires a desktop-shell session. It is shown wherever the
  preference is on and the permission is granted, a browser included, and the permission is
  re-read on every completion so a permission revoked in the meantime stops it. The desktop
  shell waits for the same switch too: a shell install whose notifications did work stops
  showing them until it is turned on.
