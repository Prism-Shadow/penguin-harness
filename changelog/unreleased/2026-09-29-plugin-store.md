# Plugins load from a content-addressed store, one activated generation at a time

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `core`, `web`, `tooling`
- **PR:** [Myriad-Dreamin/penguin-harness#92](https://github.com/Myriad-Dreamin/penguin-harness/pull/92)
- **Breaking:** yes

[中文版](2026-09-29-plugin-store.zh.md)

Every server plugin a machine receives is kept in `<data root>/plugin-store/`, filed under the hash of its content, and a process loads plugins from one place only: the generation `<data root>/plugins/current` points at. Plugin index entries carry the same hash, so a download is checked before it is stored and a Project can pin the exact content it runs. The store and the generations are swept, so neither grows with every push, install and plugin change.

## The store

- The store, the tree the build lays out and the penguin-plugins index repository file entries by one path rule. Beside `.staging/`, the store holds only `packages/`, and one entry per `packages/[<@scope>/]<bucket>/<name>/<version>/<first 16 hex digits of integrity>/`. The bucket is read off the name without its scope, the way the crates.io index files a crate: `1` or `2` for a name of that length, `3/<first character>` for three characters, and `<characters 1–2>/<characters 3–4>` otherwise, so `@penguinharness/sandbox-bwrap` is under `packages/@penguinharness/sa/nd/sandbox-bwrap/`. No directory grows with the number of plugins. An entry holds `manifest.toml` (the index manifest, `integrity` included), `package/` (the unpacked package with its dependencies inside its own `node_modules`) and the empty marker `.stored`, whose mtime is when the entry was stored. The index repository's entries also carry a `package-lock.json`; the store does not write one.
- `.stored` is written last. An entry without it does not exist, and the next write of the same content replaces it.
- `integrity` is `sha256-` and 64 hex digits over the package's deterministic archive. The archiver is `scripts/plugin-entry.mjs`, the index repository's algorithm line for line, so the hash an index entry names is the one a machine computes over the package it fetched. The build and the store lay entries out with this one module. One content is stored once; two versions of a name, or two contents of one version, are two entries.
- Two sources write the store, and nothing else does:
  - **The running build:** at every activation, each plugin listed in the `index.json` of the build's plugin prefix (a hot push's, else the installation's) is stored when its entry is missing. A failure is logged and never fails the boot. A package whose hash on this machine differs from the listed one, as on a filesystem without execute bits, is stored under its own hash.
  - **Registry:** installing from the Plugins page fetches the package with npm into a directory under `plugin-store/.staging/`, packs and hashes it, and stores it. npm no longer writes `<data root>/plugins/`.

## Generations

- `plugins/current` is a pointer file naming one generation, `plugins/<gen>/`. A generation is an npm prefix: its `package.json` lists `dependencies` (name → version) and `plugins` (name → `{ version, sha256 }`), and `node_modules/<name>` links to the store entry's `package/`. The link is a symlink on POSIX and a junction on Windows, with a copy where neither can be made.
- The generation key is the hash of its (name, sha256) list, so the same selection always maps to the same directory.
- A generation is written in `plugins/.tmp-<pid>/`, marked complete, and renamed into place. Only then is `current` flipped, by writing a temporary file and renaming it. A reader sees either the whole old generation or the whole new one.
- The loader no longer looks in the data root's npm prefix, the hot push's assets, the prefix beside the installation or the program's own dependencies; the hot push's assets and the prefix beside the installation only feed the store. An absolute path (a dev checkout's plugin) is still imported as written.

## Activation

- Every App boot activates before it imports anything: the first boot, a hot push, and every re-assembly after a plugin change. Re-assemblies run on the platform's one queue, so two admins' edits never interleave.
- The generation is resolved from the closure, the union of every Project's table for this machine:
  - A pinned name (`name = { version = "…", integrity = "…" }` in a Project's `[plugins]` table) takes that entry and no other. A malformed pin drops its entry.
  - Otherwise the loader takes the store entries whose version satisfies every Project's requirement, then the highest version, and within one version prefers the content the running build lists over a registry fetch. So a push that brings new content under an unchanged name and version takes over at the next activation.
- A listed name that no store entry satisfies is reported on the Plugins page with the reason.
- When the App fails to boot on a new generation, `current` is pointed back at the previous one. The failed generation stays on disk.
- A linked plugin runs from its store entry. When its own package cannot resolve `@prismshadow/penguin-core`, which a plugin bundle may keep external (discord-bot does), the import resolves from the running program instead, through a `module.registerHooks` resolve hook. Before, only a plugin loaded from beside the installation found the program's copy; one carried by a hot push did not.

## The index

- The index the server embedded by hand (`builtin-index.json`) is gone. `scripts/build-plugins.mjs` lays every package it ships out as a store entry and rebuilds `index.json` from that tree into the shipped prefix, so the index travels with the build: in a push's `plugins/`, in the desktop build and in a release install. A server run from source ships no prefix and lists no builtin entries.
- An entry's metadata is its package.json's. The code plugins in `plugins/` declare `author` and a top-level `categories`, which the Plugins page groups by.
- `GET /api/plugins/registry` returns a flat array of index entries, merged from the build's index, this machine's store and the published index in that order: one entry per content, the first source's kept, a yanked entry left out. It no longer carries `failures`: a source that cannot be read is logged on the server and shortens the listing.
- The Plugins page shows a name as one row, by the entry an install of it takes: the same rule the server installs by, which the web now imports from `@prismshadow/penguin-server/api` (`pickIndexEntry`). A plugin's detail page lists every content under its name, with each one's version, integrity, whether this machine's store holds it and whether the current generation links it, from the new `GET /api/plugins/registry/contents?name=…`.
- An entry without an integrity is listed and cannot be installed; its row on the Plugins page says why and disables Install. The page no longer shows a notice when a source could not be reached.

## Installing and removing

- Installing a package that is not on this machine takes the index entry the ask resolves to — the pinned content, or the highest version the range admits — fetches that exact version and compares its integrity before it enters the store. A mismatch returns `400 plugin_integrity_mismatch` with both values, and the staging directory is discarded. A name no source lists, or one listed only without an integrity, returns `400 plugin_not_installable`.
- `POST …/plugins/installed` accepts `integrity` and writes the pin.
- Removing a plugin no longer runs `npm uninstall`. The next generation leaves it out, and its store entry stays until the sweep removes it.

## The sweep

- A sweep runs right after every activation that moves `plugins/current`, and once when the server starts. It keeps the generation now current and the one current before the activation. It is best effort: a failure is logged and never fails the boot.
- It runs in the same boot as the activation, after the pointer is written, so it follows the platform's assembly queue and never runs while a generation is being written. Its store part waits its turn behind store writes, registry fetches included.
- A store entry is kept when any of these holds, and removed otherwise:
  - a kept generation links it;
  - any Project's table pins it, in the shared table or in any machine's;
  - it was stored less than a day ago.
- An entry without `.stored` is a write that never finished, and is removed once it is a day old, like a directory under `plugin-store/.staging/`. A `<version>/`, `<name>/` or bucket directory goes with its last entry.
- Every generation other than the two kept ones is removed.
- When a kept generation cannot be read, that sweep removes no store entry. It still removes old generations and old staging directories.
- A package the build ships but no generation links is swept like any other entry. The next activation stores it again from the shipped prefix, so it is there when a Project asks for it.

## Compatibility

Plugins that an earlier build installed from the registry into the old npm prefix `<data root>/plugins/node_modules/` are no longer loaded, because they are not in the plugin store. On the Plugins page they show as not installed on this machine. Installing them again from the Plugins page fetches them into the store. The old prefix's files are neither read nor removed. Plugins shipped with the build or a hot push are not affected: they reach the store at every boot.
