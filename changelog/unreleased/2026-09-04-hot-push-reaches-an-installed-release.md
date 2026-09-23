# The plugin library finds its host package at first use, and the restart step stops claiming a runtime capability

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#614](https://github.com/Prism-Shadow/penguin-harness/pull/614)

[中文版](2026-09-04-hot-push-reaches-an-installed-release.zh.md)

Two things stopped a hot push from working on an installed release. A push to a Windows installation was refused with `No package.json above the plugin loader at …\hmr\store\platform`: core's plugin library walked up from its own path for a package.json at import time, and a pushed bundle sits in the data root's store, where nothing above it is a package. And the restart step had made `runtime:lifecycle` a required capability of the runtime, so every installation predating it was refused at the handshake. The library looks for its host package on the first library call now, and the restart step claims nothing from the runtime at all.

## Details

- The host package is looked for in two places: above the loader's own module, as before, and above the running program (`process.argv[1]`), which is where a pushed platform's plugins are installed. The first package.json whose `dependencies` name a plugin package is the host; failing that, the first package.json that could be read at all — so a checkout, an npm install and the packaged desktop app resolve exactly as before, and a package.json that cannot be read on the way up is stepped over rather than answered with.
- A machine with no host package now loads the bundle and fails the library call with a message naming both places it looked, instead of failing the push.
- `LifecycleService`, the `runtime:lifecycle` resource, the `lifecycle` and `config.supervised` entries of the runtime's interface descriptor, and `supervised` in the server config are removed. The supervisor's announcement, `PENGUIN_SUPERVISED=1`, is read off the process's own environment by the platform; leaving is the runtime's own graceful shutdown, the one it registers on SIGTERM, raised in-process rather than sent as a signal, because Windows delivers none.
- Nothing changes for a runtime that supervises: "Restart and update" restarts it. On any other runtime the route answers `no_supervisor`, as it always did there. `penguin server|web` supervises exactly as before.

## Compatibility

- The restart code is forced from an `exit` listener as well as preset on `process.exitCode`. Every runtime built before this change ends its graceful shutdown with an explicit `process.exit(0)`, and a hot push cannot replace it — without the listener a pushed platform's restart would stop the service with the supervisor standing down. Nothing to do on any installation; the listener can be dropped once no supported runtime forces 0, which is one release after this one ships.
- A platform generation built between the update modal and this change claims `runtime:lifecycle`, which a runtime built from here no longer publishes. Rolling an updated installation back to such a generation is refused at the claim; rolling back to a released one is unaffected.
