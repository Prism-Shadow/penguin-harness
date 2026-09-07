# Plugins are loaded by the platform, so a push can change how they load

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `server`

[中文版](2026-09-07-plugins-load-in-the-platform.zh.md)

Which plugins a deployment runs, and how that list is read, is configuration and policy — but `loadPlugins` ran in the **runtime**, at process start. A machine whose program predated a rule could therefore never learn it from a push. That is not hypothetical: a machine given a Project's plugin list sat there with every plugin inactive, because its program still looked for the data root's old `plugins.json`, and only a restart fixed it.

The platform reads the closure and imports it now, in its own boot. Any deployment that can take a push can take a plugin change — no restart, and no requirement on how old its program is.

What stays in the registry is the imported objects: state a swap must not lose, claimed by the next App and reused by specifier, never imported twice. An entry the closure no longer names is simply absent from the new host, and its modules leave the tree with the App that had them.

The apply path shrinks to what only the runtime can do — assemble the App again — and with it goes a whole class of bug: the host in the registry is now written only by a boot that succeeded, so a plugin can no longer read as active while nothing running contains it.

The runtime keeps a load of its own as a shim, for a platform older than this move being rolled back onto it.
