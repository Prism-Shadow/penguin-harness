# The HMR layer's HTTP surface is /api/hmr

- **Date:** 2026-09-09
- **Type:** improvement
- **Scope:** `server`
- **PR:** [#656](https://github.com/Myriad-Dreamin/penguin-harness/pull/656)

[中文版](2026-09-09-hmr-layer-http-surface.zh.md)

`/api/auth` (login, logout, the one-shot claim link) and `/api/desktop` (the shell's shutdown and the client-update relay) were mounted by the HMR layer, above the platform's HTTP seam, so a change to any of them shipped only by reinstalling every installation. They are platform route groups now (`AuthRoutes`, `DesktopRoutes`, `DesktopUpdateRoutes`), served through the seam like every other route; the layer mounts `/api/hmr` and nothing else above it.

The platform's route table no longer carries a list of prefixes to decline: an unknown path under `/api/auth` answers the group's own 404 rather than the cookie gate's 401.

The layer keeps rollback copies of both groups below the seam; see [backward compatibility](2026-09-09-backward-compatibility.md).
