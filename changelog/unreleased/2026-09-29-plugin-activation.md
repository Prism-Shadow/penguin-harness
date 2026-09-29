# Plugins load from one activated generation under the data root

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`
- **PR:** [Myriad-Dreamin/penguin-harness#97](https://github.com/Myriad-Dreamin/penguin-harness/pull/97)
- **Breaking:** yes

[中文版](2026-09-29-plugin-activation.zh.md)

A process now loads server plugins from one place: the generation `<data root>/plugins/current` points at. The loader no longer looks in the data root's npm prefix, the hot push's assets, the prefix beside the installation or the program's own dependencies; those three build sources only feed the plugin store. An absolute path (a dev checkout's plugin) is still imported as written.

## Generations

- `plugins/current` is a pointer file naming one generation, `plugins/<gen>/`. A generation is an npm prefix: its `package.json` lists `dependencies` (name → version) and `plugins` (name → `{ version, sha256 }`), and `node_modules/<name>` links to the store entry's `package/`. The link is a symlink on POSIX and a junction on Windows, with a copy where neither can be made.
- The generation key is the hash of its (name, sha256) list, so the same selection always maps to the same directory.
- A generation is written in `plugins/.tmp-<pid>/`, marked complete, and renamed into place. Only then is `current` flipped, by writing a temporary file and renaming it. A reader sees either the whole old generation or the whole new one.

## Activation

- Every App boot activates before it imports anything: the first boot, a hot push, and every re-assembly after a plugin change. Re-assemblies run on the platform's one queue, so two admins' edits never interleave.
- The generation is resolved from the closure, the union of every Project's table for this machine. For each name the loader takes the store entries whose version satisfies every Project's requirement. Among those it prefers what the running build carries (its push set or the installation's prefix) over a registry fetch, then the highest version. So a push that brings new content under an unchanged name and version takes over at the next activation.
- When the App fails to boot on a new generation, `current` is pointed back at the previous one. The failed generation stays on disk.
- A listed name that no store entry satisfies is reported on the Plugins page with the reason.
- A linked plugin runs from its store entry. When its own package cannot resolve `@prismshadow/penguin-core`, which a plugin bundle may keep external (discord-bot does), the import resolves from the running program instead, through a `module.registerHooks` resolve hook. Before, only a plugin loaded from beside the installation found the program's copy; one carried by a hot push did not.

## Installing and removing

- Installing from the Plugins page fetches the package into the plugin store only. npm no longer writes `<data root>/plugins/`.
- Removing a plugin no longer runs `npm uninstall`. The next generation simply leaves it out, and its store entry stays.

## Compatibility

Plugins that an earlier build installed from the registry into the old npm prefix `<data root>/plugins/node_modules/` are no longer loaded, because they are not in the plugin store. On the Plugins page they show as not installed on this machine. Installing them again from the Plugins page fetches them into the store. The old prefix's files are neither read nor removed. Plugins shipped with the build or a hot push are not affected: they reach the store at every boot.
