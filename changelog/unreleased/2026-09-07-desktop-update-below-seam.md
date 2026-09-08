# The client-update relay moves below the hot seam

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `server`

[中文版](2026-09-07-desktop-update-below-seam.zh.md)

`/api/desktop/update` — what the desktop app's update modal reads and posts — was mounted above the platform's HTTP seam, the same misfiling the host commands had: who may see an update, what consent a download needs and what the page is shown is policy, and policy belongs to the layer that ships by push.

The platform serves it now. The runtime keeps the message port and publishes the shell's last updater frame in `runtime:shell-frames`, unread; the platform parses it on read and posts check/download/install back down the same port.

The rest of `/api/desktop` stays with the runtime and should: a one-shot login token and a process's own shutdown are mechanism, not policy. The platform declines that prefix and serves only the update subtree.

Both compatibility paths are unchanged in shape from the host-command move: an older runtime is read through its own service, and the runtime keeps a copy of the routes below the seam so a rollback to a platform that still declines the path keeps the update modal working.
