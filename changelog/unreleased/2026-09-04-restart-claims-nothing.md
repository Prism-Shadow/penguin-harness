# The restart step claims nothing from the runtime

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `server`
- **PR:** [#615](https://github.com/Prism-Shadow/penguin-harness/pull/615)

[中文版](2026-09-04-restart-claims-nothing.zh.md)

A hot push of the current platform onto any installed release was refused at boot with `this runtime publishes no business capabilities this platform can claim (config: missing supervised) — update the installation itself`. The software-update modal's restart step had made `runtime:lifecycle` a required capability of the runtime and `supervised` a required member of its published `config`, and every installed release predates both, so no existing installation could take a push. The capability is gone: the restart step now runs entirely inside the platform, and a platform carrying it boots on any runtime.

## Details

- The supervisor's announcement, `PENGUIN_SUPERVISED=1`, is read off the process's own environment by the platform; it was the one fact the capability carried, published twice.
- Leaving for the supervisor is the runtime's own graceful shutdown, the one it registers on SIGTERM, raised in-process with core's `SERVER_RESTART_EXIT_CODE` preset on `process.exitCode`; the shutdown honours a preset code instead of forcing 0. Raised as the event rather than sent as a signal, because Windows delivers none.
- `LifecycleService`, the `runtime:lifecycle` resource, the `lifecycle` and `config.supervised` entries of the runtime's interface descriptor, and `supervised` in the server config are removed. `penguin server|web` supervises exactly as before.
- Nothing changes for a runtime that supervises: "Restart and update" restarts it. On any other runtime the route answers `no_supervisor`, as it always did there.
- A runtime built from `main` between the update modal and this change forces exit code 0 in its shutdown, so a restart requested through it stops the service without a relaunch; no released runtime is in that window, and a rebuild puts one past it.
