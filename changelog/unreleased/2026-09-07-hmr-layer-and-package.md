# The HMR layer: named, packaged, and reduced to /api/hmr

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `server`, `desktop`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

[中文版](2026-09-07-hmr-layer-and-package.zh.md)

One purpose: make it hard to put product behaviour where only a reinstall can deliver it.

**The layer is named after what it does.** "Runtime" also means "the program that is running", so anything the process did sounded like it belonged to the layer. It is the HMR layer now, in the documentation and in the identifiers. The tree's node names are not renamed.

**The mechanism is `packages/hmr`.** The version store, the atomic `harness.json` commit, the resource registry and the park → boot → swap live in a package that cannot see a platform: the bundle compiled into the program is a constructor argument, and the api a platform exposes is a type parameter. Its README carries the layer's rules; the server keeps its half — the capability contract, the upgrade endpoints, the seam, and the platform itself.

**Its HTTP surface is `/api/hmr`.** `/api/auth` and `/api/desktop` are platform route groups now, served through the seam like every other route; the platform's route table no longer carries a list of prefixes to decline, and an unknown path under `/api/auth` answers 404 rather than the cookie gate's 401.

**The platform hands the layer its log.** The layer's request line goes through `log` on the platform's api, resolved per line through the host, instead of a `Log` node looked up by name at boot and held across swaps.

**The registry is the platform's state, and the ids say so.** Every entry reads `platform.<name>`. The registry is in-memory state, so the rename is a hard upgrade: a platform built with it needs a layer built with it, and the other way round.
