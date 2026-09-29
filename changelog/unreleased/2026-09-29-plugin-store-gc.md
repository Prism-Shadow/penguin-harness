# The plugin store and the activation directory are swept

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`

[中文版](2026-09-29-plugin-store-gc.zh.md)

`<data root>/plugin-store/` and `<data root>/plugins/` no longer grow with every push, install and plugin change. A sweep runs right after every activation that moves `plugins/current`, and once when the server starts. It is best effort: a failure is logged and never fails the boot.

## What is kept

- A store entry is kept when any of these holds, and removed otherwise:
  - the current or the previous generation links it;
  - the activation list of a hot push's assets the harness still keeps (the current set and its rollback copy under `hmr/store/assets/`) names it. That list is the `index.json` the build writes into the plugin prefix. For a push from before that file, it is the prefix's `package.json`, which keeps every content of each name and version it lists. A rollback set the platform never unpacked is read from its `archives/plugins.tgz`;
  - any Project's table pins it, in the shared table or in any machine's;
  - it was stored less than a day ago.
- An entry without `.stored` is a write that never finished. It is removed once it is a day old.
- A `<version>/` or `<name>/` directory is removed with its last entry, and `index.json` is rebuilt.
- Every generation other than the current and the previous one is removed.
- A directory under `plugin-store/.staging/` whose process is no longer running is removed.
- When what must be kept cannot be read (a generation or an assets set's list), that sweep removes no store entry. It still removes old generations and dead staging directories.

## Order

- `plugins/previous` names the generation `current` pointed at before its last flip. `current` and `previous` are the two generations the sweep keeps.
- The sweep runs in the same boot as the activation, after the pointer is written, so it follows the platform's assembly queue and never runs while a generation is being written. Its store part also waits its turn behind store writes, and a registry fetch now takes that turn too.
- A package the build ships but no generation links is swept like any other entry. The next activation stores it again from the shipped prefix, so it is there when a Project asks for it.
- Store entries under the key used before [Myriad-Dreamin/penguin-harness#100](https://github.com/Myriad-Dreamin/penguin-harness/pull/100) (the node-tar hash) are no longer linked by any new generation, so they go once they are a day old.
