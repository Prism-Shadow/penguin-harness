# A hot update's live version is what is running, not what reached disk

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `server`

[中文版](2026-08-23-hmr-live-version-truth.zh.md)

Three ways a hot update could leave the process pointed at something that was not what it was running: an interface it never verified, a version it could no longer find, and a directory belonging to the version before. Each one came from taking a fact off disk, or off a bundle's own word, instead of from what the host actually had.

## Details

- The platform interface a bundle ships is the only thing `boot` checks its implementation against, so a pushed bundle could declare fewer methods than the runtime calls and land successfully — then fail at a request (`business()`), at process exit (`shutdown()`), or at the next swap. The set the runtime calls is now declared by the host, the packaged platform declares exactly it, and every path that loads a bundle refuses one whose declaration is short. `drained` is deliberately excluded: the kernel calls it optionally, so a platform with no asynchronous teardown tail may omit it.
- Boot-failure recovery re-read the previous version from `harness.json`. Persisting a pushed version is allowed to fail — the push still applies and keeps serving — so that entry could be absent, in which case recovery failed outright and left a disposed App answering out of its closures, or stale, in which case it booted older code against the newer version's parked document. The host keeps the running bundle in memory and recovers from that.
- A version's native-module assets were published only when it had some, so a push carrying none kept pointing at its predecessor's directory while committing a manifest that omits assets. The running process went on loading the previous version's binaries, a restart behaved differently, and pruning that directory when it aged out of the store broke terminal creation. The pointer now follows the version in both directions, and the fallback to the packaged platform clears it.
