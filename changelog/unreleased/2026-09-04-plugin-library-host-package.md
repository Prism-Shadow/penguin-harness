# The plugin library finds its host package on first use, from two fixed starting points

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `core`
- **PR:** [#798](https://github.com/Prism-Shadow/penguin-harness/pull/798)

[中文版](2026-09-04-plugin-library-host-package.zh.md)

A hot push to a Windows installation was refused with `No package.json above the plugin loader at …\hmr\store\platform`: the platform bundle threw while loading, because core's plugin-library loader walked up from the bundle's own path for a package.json at import time, and a pushed bundle sits in the data root's store where nothing above it is a package. The host package — the package.json whose `dependencies` name the plugin packages — is now determined on the first library call, never at import, from two fixed starting points: the installation the loader sits in, and the installation of the running program (`process.argv[1]`), which is where a pushed platform's plugins are installed.

## Details

- Each starting point is walked upward to the first package.json whose `dependencies` name a plugin package; the loader's own installation is tried first. A package.json on the way that names no plugin package, or cannot be read or parsed, is skipped rather than taken as the answer.
- There is no fallback to the first package.json that could be read: when neither starting point leads to a host, the library call fails with a message naming both places it started from, instead of the push failing or the library silently coming up empty.
- The program's path has its symlinks resolved first, so a package manager's bin leads to the installation it belongs to.
- Plugin packages resolve through the host package's own `require`, so the library never looks for them next to the store.
- A library a hot push carried ([its own entry](2026-09-19-pushed-plugin-library.md)) outranks both starting points and is walked the same way; without one, a pushed platform reads the plugins installed with the program.
