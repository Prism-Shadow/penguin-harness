# The server's test shards build the server's own dependencies

- **Date:** 2026-09-09
- **Type:** fix
- **Scope:** `ci`

[中文版](2026-09-09-ci-server-shard-builds-its-own-deps.zh.md)

Every server test file failed to load, on all three platforms, with `Cannot find package '@prismshadow/penguin-hmr/manifest'`. The shards run the server's tests but built `@prismshadow/penguin-core...` — core and core's dependencies. That was the whole closure back when the hot-update layer lived inside the server package; since it became `@prismshadow/penguin-hmr`, a workspace package of its own that the server depends on, nothing in those shards ever built it, and the tests could not resolve their first import.

The server shards (`server` on Linux and macOS, `server-1..3` on Windows) now build `@prismshadow/penguin-server...` — the server and everything it depends on, which is what a shard that runs its tests needs.
