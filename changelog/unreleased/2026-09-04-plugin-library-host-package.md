# The plugin library finds its host package on first use, and above the program that booted it

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#614](https://github.com/Prism-Shadow/penguin-harness/pull/614)

[中文版](2026-09-04-plugin-library-host-package.zh.md)

A hot push to a Windows installation was refused with `No package.json above the plugin loader at …\hmr\store\platform`: the platform bundle threw while loading, because core's plugin-library loader walked up from the bundle's own path for a package.json at import time, and a pushed bundle sits in the data root's store where nothing above it is a package. The loader now looks for its host package on the first library call, never at import, and looks in two places: above its own module, as before, and above the running program (`process.argv[1]`), which is where a pushed platform's plugins are installed.

## Details

- The first package.json whose `dependencies` name a plugin package is the host; failing that, the first package.json found, so a checkout, an npm install and the packaged desktop app resolve exactly as before.
- A machine with no host package at all now loads the bundle and fails the library call with a message naming both places it looked, instead of failing the push.
- Plugin packages resolve through the host package's own `require`, so a pushed platform reads the plugins installed beside the program rather than looking for them next to the store.
