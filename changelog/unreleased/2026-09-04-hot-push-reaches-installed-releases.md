# A hot push reaches an installed release: the plugin library's host package and the restart step

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#614](https://github.com/Prism-Shadow/penguin-harness/pull/614)

[中文版](2026-09-04-hot-push-reaches-installed-releases.zh.md)

Two things stopped a hot push from reaching an installed release: the plugin library looked for its host package at import time, and the restart step claimed a capability no released runtime publishes. Both are gone, so a platform built from here loads and boots on any installed runtime.

## The plugin library's host package

A hot push to a Windows installation was refused with `No package.json above the plugin loader at …\hmr\store\platform`: the platform bundle threw while loading, because core's plugin-library loader walked up from the bundle's own path for a package.json at import time, and a pushed bundle sits in the data root's store where nothing above it is a package. The host package — the package.json whose `dependencies` name the plugin packages — is now determined on the first library call, never at import, from two fixed starting points: the installation the loader sits in, and the installation of the running program (`process.argv[1]`), which is where a pushed platform's plugins are installed.

- Each starting point is walked upward to the first package.json whose `dependencies` name a plugin package; the loader's own installation is tried first. A package.json on the way that names no plugin package, or cannot be read or parsed, is skipped rather than taken as the answer.
- There is no fallback to the first package.json that could be read: when neither starting point leads to a host, the library call fails with a message naming both places it started from, instead of the push failing or the library silently coming up empty.
- The program's path has its symlinks resolved first, so a package manager's bin leads to the installation it belongs to.
- Plugin packages resolve through the host package's own `require`, so a pushed platform reads the plugins installed with the program rather than looking for them next to the store.

## The restart step

A hot push of the current platform onto any installed release was refused at boot with `this runtime publishes no business capabilities this platform can claim (config: missing supervised) — update the installation itself`. The software-update modal's restart step had made `runtime:lifecycle` a required capability of the runtime and `supervised` a required member of its published `config`, and every installed release predates both, so no existing installation could take a push. The capability is gone: the restart step now runs entirely inside the platform, and a platform carrying it boots on any runtime.

- The supervisor's announcement, `PENGUIN_SUPERVISED=1`, is read off the process's own environment by the platform; it was the one fact the capability carried, published twice.
- Leaving for the supervisor is the runtime's own graceful shutdown, the one it registers on SIGTERM, raised in-process with core's `SERVER_RESTART_EXIT_CODE` preset on `process.exitCode`; the shutdown honours a preset code instead of forcing 0. Raised as the event rather than sent as a signal, because Windows delivers none.
- `LifecycleService`, the `runtime:lifecycle` resource, the `lifecycle` and `config.supervised` entries of the runtime's interface descriptor, and `supervised` in the server config are removed. `penguin server|web` supervises exactly as before.
- Nothing changes for a runtime that supervises: "Restart and update" restarts it. On any other runtime the route answers `no_supervisor`, as it always did there.
- The restart code is also forced from an `exit` listener, so a pushed platform's restart leaves with it and is relaunched even on a runtime whose own shutdown forces exit code 0; no installation needs any action. The listener can be dropped once no supported runtime forces 0, which is one release after this one ships. What remains is a rollback window: a platform generation built between the update modal and this change claims `runtime:lifecycle`, so rolling back to it on a runtime built from here is refused at the claim; rolling back to a released one is unaffected.
