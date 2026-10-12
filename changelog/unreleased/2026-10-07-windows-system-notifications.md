# A confirmation notification on opt-in, and a registered notification sender on Windows

- **Date:** 2026-10-07
- **Type:** fix
- **Scope:** `web`, `desktop`
- **PR:** [#998](https://github.com/Prism-Shadow/penguin-harness/pull/998)
- **Issue:** [#997](https://github.com/Prism-Shadow/penguin-harness/issues/997)

[中文版](2026-10-07-windows-system-notifications.zh.md)

Turning on task completion notifications in Settings › General gained a confirmation notification: it appeared as soon as the system granted permission, on every platform, and the switch's description said so. A refused or dismissed permission request showed nothing and left the switch off, as before.

At every launch, the Windows desktop app registered its AppUserModelID under `HKCU`, with the app's display name and icon, so the dev profile and builds run without the installer could show notifications too. Startup did not wait for the registration; a registry write that failed or ran longer than five seconds was logged and abandoned.
