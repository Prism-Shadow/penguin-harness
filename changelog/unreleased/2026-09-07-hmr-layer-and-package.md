# The HMR layer: named, packaged, and reduced to /api/hmr

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `hmr`, `server`, `desktop`, `tooling`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

[中文版](2026-09-07-hmr-layer-and-package.zh.md)

One purpose: make it hard to put product behaviour where only a reinstall can deliver it.

**The layer is named after what it does.** "Runtime" also means "the program that is running", so anything the process did sounded like it belonged to the layer. It is the HMR layer now, in the documentation and in the identifiers. The tree's node names are not renamed.

**The mechanism is `packages/hmr`.** The version store, the atomic `harness.json` commit, the resource registry and the park → boot → swap live in a package that cannot see a platform: the bundle compiled into the program is a constructor argument, and the api a platform exposes is a type parameter. Its README carries the layer's rules; the server keeps its half — the capability contract, the upgrade endpoints, the seam, and the platform itself.

**Its HTTP surface is `/api/hmr`.** `/api/auth` and `/api/desktop` are platform route groups now, served through the seam like every other route; the platform's route table no longer carries a list of prefixes to decline, and an unknown path under `/api/auth` answers 404 rather than the cookie gate's 401.

**The platform hands the layer its log.** The layer's request line goes through `log` on the platform's api, resolved per line through the host, instead of a `Log` node looked up by name at boot and held across swaps.

**The upgrade channel is a route the platform declares, with a protocol the mechanism owns.** `/api/hmr` is contributed to the platform's route table like any other group (network gate, then the platform's auth, then admin), and what a push is — its body, its answer — is `packages/hmr`'s `upgradeEndpoint`, reached through the control object any generation can claim. A generation that would not serve the channel is refused before commit (`admitsUpgradeRoute`): the previous one stays, and the installation can never be left with no way to push. The layer reserves nothing above the seam.

**The frozen operations are `hmrMain`, in the package.** Which generation a request goes to (and the wait for an in-flight swap), how a push is applied and what happens when its boot fails, and what the product refreshes once a generation is current — the pushed one, or the previous one re-booted — are `packages/hmr`'s `main.ts`. The server's entry hands it the host, its refresh (the tree it resolves nodes from), and its own start; the seam and the upgrade route drive the control object, never the host. The port is bound before any of that runs, so a client that arrives during startup is answered rather than refused: it gets 503 with `Retry-After`, and a browser gets a page that comes back on its own. The port announcement (`PENGUIN_PORT_FILE`) stays what it always meant — the App is up — by moving to the end of startup, so a reader that waits for it, the desktop shell above all, is never handed a server that only answers "starting".

**A push works the way `git push` does.** A push used to carry every part inline every time — both bundles, the whole web dist, every native asset — base64 inside one gzip JSON body, whether or not the target already held it. The store is content-addressed now (`store/blobs/<sha256>`, each distinct file once): `POST /api/hmr/assets/probe { hashes }` answers which blobs the target lacks, `PUT /api/hmr/blobs/<sha256>` stores one blob from a raw body if it hashes to the name, and the push body keeps its one shape with every content value — `platform`, `cli`, each `web.files` and `assets.files` entry — allowed to be `{ sha }` instead of inline, resolved from the store before anything boots; a name the store does not hold is refused with the hash, never materialized as a hole. `scripts/deploy.mjs` probes, uploads only the missing blobs, and pushes a body of names, so a push carries only what changed since the last one. A target without the probe answers 404 and gets every part inline, the push it always received. A blob neither the committed version nor a kept assets set records is swept with the old sets.

**A fault is named, never defaulted.** Three places used to answer a broken state with a normal-looking one, which is how a real failure becomes invisible. A `harness.json` that cannot be read is no longer indistinguishable from a root that never pushed: the host says so and boots the packaged platform, and `penguin-hmr` says which of the two it hit rather than always "no CLI pushed here". A generation is admitted to the store only if it answers the upgrade path the way the channel itself would AND answers a path nothing serves differently, so a platform that gates its whole API is refused instead of being read as "the channel is there, gated". And when no generation is current at all, the seam answers 503 saying so rather than passing the request to the static tail, which would have returned the SPA shell with a 200 for an API call.

**The registry is the platform's state, and the ids say so.** Every entry reads `platform.<name>`. The registry is in-memory state, so the rename is a hard upgrade: a platform built with it needs a layer built with it, and the other way round.
