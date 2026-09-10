# The HMR layer: named, packaged, and reduced to /api/hmr

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `server`, `desktop`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

[中文版](2026-09-07-hmr-layer-and-package.zh.md)

One purpose: make it hard to put product behaviour where only a reinstall can deliver it.

**The layer is named after what it does.** "Runtime" also means "the program that is running", so anything the process did sounded like it belonged to the layer. It is the HMR layer now, in the documentation and in the identifiers. The tree's node names are not renamed: an older layer resolves a pushed platform's nodes by name, and a parked document is keyed by name.

**The mechanism is `packages/hmr`.** The version store, the atomic `harness.json` commit, the resource registry and the park → boot → swap live in a package that cannot see a platform: the bundle compiled into the program is a constructor argument, and the api a platform exposes is a type parameter. Its README carries the layer's rules; the server keeps its half — the capability contract, the upgrade endpoints, the seam, and the platform itself.

**Its HTTP surface is `/api/hmr`.** `/api/auth` and `/api/desktop` are platform route groups now, served through the seam like every other route; the platform's route table no longer carries a list of prefixes to decline, and an unknown path under `/api/auth` answers 404 rather than the cookie gate's 401.

**A resource id says which layer owns it.** `hmr:*` is a capability only the process can provide; `platform:*` is the platform's own state, parked so a swap does not lose it. The old `runtime:*` ids stay as aliases for one release.

The rollback copies of the two route groups and the id aliases are recorded in [backward compatibility](2026-09-09-backward-compatibility.md).
