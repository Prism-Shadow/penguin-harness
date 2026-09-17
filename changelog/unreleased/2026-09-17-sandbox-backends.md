# Sandbox backends: a load-time check, a writable temp directory, and no MXC backend

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `server`, `core`, `plugins`, `tooling`
- **PR:** [#771](https://github.com/Prism-Shadow/penguin-harness/pull/771)

[中文版](2026-09-17-sandbox-backends.zh.md)

The sandbox's native backends stopped mounting where they cannot serve, confining modes gained a writable temp directory, and the MXC backend for Windows was removed.

## Details

- **A backend checks at load that it can serve.** bwrap and Seatbelt load through `loadPenguinBwrapProvider` / `loadSeatbeltProvider`. Off their own platform they decline; on it they run their base-profile probe without blocking and reject, with the reason, when the runner is missing or refuses the profile. Before, both built a provider on every platform, so a Windows host counted bwrap as a mounted backend covering every dimension and routed every confining policy to it. The confine-time probe stays.
- **Nothing is silently absent.** `SandboxService` settles every backend source at once, in routing order, and records a rejection as a failure and a null as a decline. When a command fails closed, the message names both: `backends not in use: <name> (<reason>); <name> (not for this host)`.
- **The temp directory is writable in either confining mode.** `SandboxPolicy` gained `writableTemp`, and the service sets it on every confining policy: bwrap mounts a private, writable `/tmp` (binding `$TMPDIR` too when it lives elsewhere) and Seatbelt allows the temp areas. Before, `read-only` left them read-only, and shells failed before running anything.
- **The MXC backend was removed.** `plugins/sandbox-mxc` is gone, the builtin plugin registry lists three sandbox backends, and `@microsoft/mxc-sdk` left the workspace. On Windows, the DSH adaptor remains and covers file effects only.
