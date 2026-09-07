# The layer is called HMR, and its mechanism is a package of its own

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `server`, `desktop`

[中文版](2026-09-07-hmr-layer-and-package.zh.md)

Two changes with one purpose: make it hard to put product behaviour where only a reinstall can deliver it.

**The layer is named after what it does.** "Runtime" also means "the program that is running", so anything the process did sounded like it belonged to the layer — and what lands there ships by rebuilding and redeploying every installation. It is the HMR layer now, in the documentation and in the identifiers. The resource id strings keep their `runtime:` prefix on purpose: an id is a wire contract between generations, and renaming one would make an older layer's registration invisible to a newer platform.

**The mechanism moved into `packages/hmr`.** The version store, the atomic `harness.json` commit, the resource registry and the park → boot → swap now live in a package that cannot see a platform: the bundle compiled into the program is a constructor argument, and the api a platform exposes is a type parameter. Its README states the rule — mechanism only, and not to be changed without asking — and the package boundary is what enforces it, rather than discipline.

What stays with the server is its half of the layer: which capabilities a platform may claim, the upgrade endpoints, the HTTP seam, and the platform itself.

Internal, and inlined into the server's bundle: a boundary in the source tree, not another package on npm.

The tree's node names are **not** part of the rename, for the same reason the resource ids are not: an older runtime resolves nodes in a pushed platform by name, and a parked document is keyed by name. A push that renamed one would kill every older installation at boot.
