# The sandbox is there on every install

- **Date:** 2026-09-28
- **Type:** feat
- **Scope:** `release`, `server`, `web`

[中文版](2026-09-28-sandbox-on-every-install.zh.md)

The same sandbox on every platform and every way of installing: the composer's permission menu,
the Sandbox card on the Settings dialog's Plugins page, and this platform's backend ready to
enable. What differs by platform is which backend serves and its own options, drawn inside the
Sandbox card. Confinement still starts Off; nothing is enabled for the operator.

- **The installed CLI carries the builtin plugins.** Every installer payload (Linux, macOS,
  Windows) now ships the builtin plugin prefix under `lib/plugins/` — the four sandbox backends
  among them — as the desktop app already did. Enabling this platform's backend from the Plugins
  page copies nothing over the network; before, an installed CLI had to fetch it from the npm
  registry, and on a host that cannot reach it there was no sandbox to enable.
- **The composer says when nothing can enforce a level.** With no sandbox backend installed,
  Read only, Workspace write, No network and Local network stay listed, greyed out and marked
  "Not installed", with how to add one in their tooltip — where before they could be picked and
  every command was then refused. A backend that confines files but not the network (the DSH
  adaptor) greys out only the network levels it cannot enforce.
- The Session's `sandbox` object in the API gains two response-only flags beside
  `localNetworkSupported`: `confinementSupported` (Read only and Workspace write can be
  enforced) and `noNetworkSupported` (No network can be).
