# Hot update carries native modules, identity and the CLI it pushes

- **Date:** 2026-08-19
- **Type:** feature
- **Scope:** `server`, `desktop`, `tooling`

[中文版](2026-08-19-hmr-assets.zh.md)

Three things a push could not reach before: a native module, the identity of whoever is
calling a pushed endpoint, and — on the desktop app — the pushed CLI itself.

## Native modules travel as assets

A pushed bundle is imported from `<dataRoot>/hmr/store/platform/<sha>.mjs`, where neither a
package's own relative `build/Release/*.node` nor a bare specifier resolves, so a platform
needing a native module was stuck behind a full server release. A push now carries a third
artifact: base64 files with an `exec` list, unpacked into a content-addressed
`store/assets/<sha>/` laid out as a real `node_modules` tree, where the package's own
resolution works again. The directory is published through the resource registry for
platform code to claim, lands before boot with the pointer restored if boot fails, is
committed into `harness.json` with the platform and CLI pointers, republished on restart,
and kept by prune while a version references it.

Modes come from the `exec` list — base64 has no mode, and a helper binary without its exec
bit fails to spawn. An identical set is never re-written: these are native modules, and on
Windows the copies from the last push are mapped into the running process, so reopening one
for writing fails with `EBUSY` and takes the upgrade down with it. `.materialized`, written
last, is what distinguishes a complete directory from one a killed push left half-written.

`scripts/deploy.mjs` collects the packages named in `NATIVE_PACKAGES`, skips any that do not
resolve, and omits the payload when there are none.

## A pushed endpoint knows who is calling

The seam offers the platform every request before the auth middleware runs — deliberate,
since a push must be able to decide its own authentication — which left pushed code with no
user in hand and no way to get one except re-implementing session lookup against cookie
names and TTLs the runtime owns. The runtime now registers its own resolver in the resource
registry (`runtime:identity`) for platform code to claim. A runtime too old to publish one
yields a resolver that authenticates nobody: an unattributable request is not a request from
every user.

## The desktop app can run the CLI it was pushed

`penguin-hmr` — the entry that runs whatever CLI has been pushed to this machine instead of
the built-in one — was not shipped inside the app at all, so a CLI fix could reach an
installed desktop app and stay unreachable. It is now its own bundle with its own launcher
at `<app>/bin/penguin-hmr`. Separate bundle by necessity: the entry decides whether it is
the process entry point by comparing `import.meta.url` against `argv[1]`, so sharing a file
with `penguin.js` would send every plain `penguin` run looking for a pushed CLI.

`bin/penguin` still means the built-in CLI, and PATH exposure ("Install 'penguin' Command")
still installs that one — which of the two the bare command means is a product decision, not
a packaging detail.
