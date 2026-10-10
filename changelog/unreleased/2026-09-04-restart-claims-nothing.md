# The restart step claims nothing from the runtime

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `server`
- **PR:** [#798](https://github.com/Prism-Shadow/penguin-harness/pull/798)

[中文版](2026-09-04-restart-claims-nothing.zh.md)

A hot push of the current platform onto any installed release was refused at boot with `this runtime publishes no business capabilities this platform can claim (config: missing supervised) — update the installation itself`. The software-update modal's restart step had made `runtime:lifecycle` a required capability of the runtime and `supervised` a required member of its published `config`, and every installed release predates both, so no existing installation could take a push. The capability is gone: the restart step now runs entirely inside the platform, and a platform carrying it boots on any runtime.

## Details

- The supervisor's announcement, `PENGUIN_SUPERVISED=1`, is read off the process's own environment by the platform; it was the one fact the capability carried, published twice.
- Leaving for the supervisor is the runtime's own graceful shutdown, the one it registers on SIGTERM, raised in-process with core's `SERVER_RESTART_EXIT_CODE` preset on `process.exitCode`; the shutdown honours a preset code instead of forcing 0. Raised as the event rather than sent as a signal, because Windows delivers none.
- `LifecycleService`, the `runtime:lifecycle` resource, the `lifecycle` and `config.supervised` entries of the runtime's interface descriptor, and `supervised` in the server config are removed. `penguin server|web` supervises exactly as before.
- Nothing changes for a runtime that supervises: "Restart and update" restarts it. On any other runtime the route answers `no_supervisor`, as it always did there.
- The restart code is also forced from an `exit` listener, so a pushed platform's restart leaves with it and is relaunched even on a runtime whose own shutdown forces exit code 0; no installation needs any action. The listener can be dropped once no supported runtime forces 0, which is one release after this one ships. What remains is a rollback window: a platform generation built between the update modal and this change claims `runtime:lifecycle`, so rolling back to it on a runtime built from here is refused at the claim; rolling back to a released one is unaffected.
