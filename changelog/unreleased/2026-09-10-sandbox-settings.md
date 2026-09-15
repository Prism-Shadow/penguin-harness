# Sandbox settings

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`
- **PR:** [#674](https://github.com/Prism-Shadow/penguin-harness/pull/674)

[中文版](2026-09-10-sandbox-settings.zh.md)

The sandbox — the confinement every agent command spawns under — could only be configured by editing a parked document. It has a surface now, and it is the plugin configuration surface rather than a page of its own.

- **A card on Settings → Plugins** (admin), first on the page: the confinement mode (off / workspace-write / read-only), whether the network is cut off, and the paths masked from confined commands. It is a settings group the sandbox declares — a schema drawn, validated and stored like any plugin's settings (`plugin-config:sandbox`, through `/api/admin/plugin-config`) — so a change applies to the next command spawn with no restart, and a restart keeps it.
- **Backends' own settings inside it.** A backend that has settings declares its own group with `parent: "sandbox"` beside its `SandboxModule.providers` contribution, and reads it itself through `PluginConfig` at each spawn; the group is drawn inside the Sandbox card and saved with it. bwrap declares its program and probe timeout, Seatbelt and MXC their program; a changed program is probed afresh.
- **What enforces it, said plainly.** The card lists the mounted backends and the isolation dimensions each implements, and when there are none it says so — a mode chosen without a backend confines nothing, and a security control that implies otherwise is worse than an absent one.
