# Sandbox settings

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#673](https://github.com/Prism-Shadow/penguin-harness/pull/673)

[中文版](2026-09-10-sandbox-settings.zh.md)

The sandbox — the confinement every agent command spawns under — could only be configured by editing a parked document. It has a surface now.

Settings gains a **Sandbox** page (admin): the confinement mode (off / workspace-write / read-only), whether the network is cut off, and the paths masked from confined commands. `GET|PUT /api/admin/sandbox`; a change applies to the next command spawn, with no restart, and the settings park with the platform so they survive a hot update.

What enforces confinement is a backend contributed by a plugin (bwrap, Seatbelt, MXC, DSH). The page lists the mounted backends and the isolation dimensions each implements, and when there are none it says so plainly — a mode chosen without a backend confines nothing, and a security control that implies otherwise is worse than an absent one.
