# A plugin change no longer leaves the runtime on the disposed App

- **Date:** 2026-09-22
- **Type:** fix
- **Scope:** `server`
- **PR:** [#0000](https://github.com/Prism-Shadow/penguin-harness/pull/0000)

[中文版](2026-09-22-shell-tree-after-reassembly.zh.md)

The runtime holds the App's module tree for what it does itself: the websocket handshake's authentication, the hot-update gate, the settings it reads at start, and the record of a process-level error. That tree was a snapshot, re-pointed only when a push landed. A plugin install or removal re-assembles the App inside the same platform instance — no push, so the snapshot stayed on the App that had just been disposed. The next websocket handshake then asked the disposed tree for the auth service (`no api 'Auth' on module 'IdentityModule'`), the rejection handler asked it for the error recorder, threw inside the handler, and the process exited.

- `ServerBoot` now holds the platform instance and reads `tree` off it on every use; the replace hooks re-point the instance. A re-assembly is followed the moment it completes, a push as before.
- The process-level handlers record an error inside a guard: a tree that cannot answer leaves a second console line, never a second failure.
- `TestApp` exposes `boot`, and a test drives an install through the route and checks the runtime's tree is the re-assembled App's while the first generation's is disposed.

This is runtime code, below the hot-update seam: an installation gets it with a runtime reinstall, not with a push. Until then, pushing once after a plugin change re-points the tree.
