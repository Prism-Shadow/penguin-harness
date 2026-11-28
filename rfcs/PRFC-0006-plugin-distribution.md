# PRFC-0006 Plugin Distribution and Installation

[中文版](PRFC-0006-plugin-distribution.zh.md)

> **Source**: `rfcs/PRFC-0006-plugin-distribution.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — a draft, see design PR [#244](https://github.com/Prism-Shadow/penguin-harness-design/pull/244) (draft).
> **Rev**: v1.0.0 (migrated into the main repository, taking the draft's current version); the conventions for this surface are in [README.md](README.md), and changes from version to version are recorded in `## Changes` at the end.

- Feature Name: `plugin_distribution`
- Start Date: 2026-10-01
- PRFC PR: [Prism-Shadow/penguin-harness-design#244](https://github.com/Prism-Shadow/penguin-harness-design/pull/244)
- Implementation PR: [Myriad-Dreamin/penguin-harness#92](https://github.com/Myriad-Dreamin/penguin-harness/pull/92) (download, loading, index), [Myriad-Dreamin/penguin-harness#98](https://github.com/Myriad-Dreamin/penguin-harness/pull/98) (channels)

## Summary

[summary]: #summary

Defines the whole line from a plugin's **release** to **being loaded on a machine**: which distribution channels exist and what each carries; how a plugin is installed and uninstalled, where it lives on a machine, and how it is found; which steps must be atomic; and the one checksum that is compared along the whole line.

- There is only one kind of plugin: an npm package that **contributes** things — Skills and hooks to an Agent, Modules to the harness; one plugin can contribute both. On each machine it stays, as an unpacked package, inside the prefix it arrived in: the installation directory's, the hot-push asset's, or the data root's; at load time one copy is picked, according to the plugin table, between the running build's prefix and the data root's prefix, regardless of what it contributes.
- What can be installed is answered first by the **catalog** (the index published by penguin-plugins); when there is no network it falls back to the **build index** that every channel carries. Installers, hot pushes, and source checkouts also **carry** plugin packages; the CLI package on npm carries only the index, and the plugin is **downloaded** from the registry at enable time.
- A plugin enters a machine only through the plugin page's "Install"; the plugin table never names a package that is not on the machine; download and replacement both unpack first, then rename into place, then delete the old — after a crash, recovery needs no network.
- Releasing a version is one set of npm publishes plus one set of catalog entries: precheck everything first, then publish in dependency order; the run is rerunnable and resumes where it stopped; catalog entries are added only after every npm publish has succeeded.
- The checksum is npm's `dist.integrity`.

## Motivation

[motivation]: #motivation

The starting point was "a sandbox cannot be installed from the Web UI". The investigation turned up a chain of distribution gaps; the state before 2026-10-01:

- **Channels carried different things.** Plugins contributing Modules arrived only with the desktop build and hot pushes; the CLI installer, npm, and Docker carried none; the four sandbox backends are private, absent from npm.
- **Four lookup locations on one machine.** The directory npm installed into under the data root, the plugin directory inside hot-push assets, the plugin directory next to the installation directory, and the program's own dependencies. Which of them holds a given package, and which copy of its content, could only be learned by trying each in turn; and nothing anywhere deleted old content.
- **The catalog did not tell the truth.** The plugin page listed every backend on every channel; only after clicking install did one get `plugin_not_shipped` or npm's E404.
- **The checksum was computed three ways in three places.** The build, the server's on-demand fetch, and the index repository each expanded dependencies under their own install rules before hashing; a package with dependencies (`sandbox-dsh`) actually hit `plugin_integrity_mismatch` on a local registry.
- **Release was not atomic.** The 0.2.13 release loop published packages one by one in alphabetical order and failed only at a name npm had never seen; the earlier ones had already gone out.
- **The designs contradicted each other.** [design#232](https://github.com/Prism-Shadow/penguin-harness-design/pull/232) said "every distribution carries the full bundled plugin directory, installation never downloads"; PRFC-0003 said "install into `<root>/plugins/`"; roadmap #6's proposal #11 (the organization's proposal ledger) said "one plugin repository, three sources, fetched from the registry on demand".

Scenarios:

- An installer user enables `sandbox-bwrap` on the plugin page: the installer carries it; enabling needs no network.
- A user of a global npm install enables the same plugin: it is in the index the CLI package carries; the server downloads it from the registry, verifies it, unpacks it into the data root, then reassembles.
- A machine receives a hot push: the pushed plugins and plugin library replace the old ones, taking effect at the next assembly; plugins that the new push no longer carries but Projects still use are rescued into the data root before the old asset is cleaned up.
- A third-party author publishes `@acme/sandbox-firejail` to npm and submits an entry to penguin-plugins; users on any channel can install it from the catalog.
- A release fails midway on the network: rerunning the same tag skips what is already on npm and resumes from the breakpoint; the catalog entries have not been added yet.

## Guide-level explanation

[guide-level-explanation]: #guide-level-explanation

### The plugin

A plugin is an npm package (`plugins/<dir>` published as `@penguinharness/<dir>`), and it **contributes** things:

- Skills and hooks to an **Agent**: the user installs it onto an Agent, and the Agent gets a copy;
- Modules to the **harness** (sandbox backends, message connectors, languages…): the Project's `[plugins]` table names it, and the process loads it at assembly.

A plugin can contribute both. Distribution and installation look only at the package, not at what it contributes: arrival, verification, placement, and loading are all the same line.

**A plugin packages itself: its tarball is all there is.** The code a plugin needs is packed into its own package at build time; the host SDK (`@prismshadow/penguin-core`) is provided by the running program. We do not install the dependencies a plugin declares: a dependency that happens to have been npm-installed next to the plugin may work, but that is not promised.

### Channels

Every build carries a **bundled plugin directory**: `build-plugins` packs each plugin this build will carry once with `pnpm pack`, computes the integrity, then unpacks that tarball into an npm prefix and writes the build index.

```
plugins/
  index.json                         the build index: each plugin's name / version / integrity
  node_modules/<name>/{.integrity, package.json, …}
                                     the unpacked plugin package; .integrity records the integrity of the tarball it came from
```

The tarball produced here is the very one published to npm; it exists only at build and release time and is not shipped down any channel.

| Channel                                               | Bundled plugin directory                                                              | Carries plugin packages      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------- |
| CLI installer (incl. OSS mirrors, one-line installer) | `lib/plugins/`                                                                        | yes                          |
| Desktop                                               | `plugins/` in the application directory                                               | yes                          |
| Docker image                                          | `/opt/penguin/lib/plugins/`                                                           | yes                          |
| Hot push                                              | `plugins/` in the push asset, one archive per package, unpacked once on arrival       | yes                          |
| Source checkout (development)                         | `packages/cli/plugins/`, `packages/server/plugins/`, written by the development build | yes (locally built packages) |
| npm (`@prismshadow/penguin-cli`)                      | `plugins/` inside the package, `index.json` only                                      | no                           |
| Machines remote install                               | follows whichever path the machine chose                                              |                              |

The server looks for it one level up from the program's entry point; when a hot push is present, it uses the copy in the push asset. Plugins the build does not carry but a Project requires are downloaded from the registry into the data root's `plugins/`.

### What it looks like on a machine

```
<install-dir>/plugins/                 arrives with the installer, upgrades with the installer
<data-root>/hmr/store/assets/<sha>/.unpacked/plugins/
                                       arrives with the hot push, retained and cleaned up with the hot push
<data-root>/plugins/                   plugins downloaded from the registry
  node_modules/<name>/{.integrity, package.json, …}
  .staging/                            staging for download, unpacking, replacement
<Project>/.project_config.toml         [plugins]: which plugins this Project requires
```

All three are the same kind of npm prefix; each plugin is an unpacked package under `node_modules/<name>/`. A plugin stays where it arrived and is not copied (the H rescue excepted). Loading looks at two of them: the running build's (the push asset's when a hot push is present, otherwise the installation directory's) and the data root's.

### Install, uninstall, manage

- **Install** (plugin page, admin): `POST /api/projects/:p/plugins/installed { specifier, machineId?, integrity? }`. A package this machine is to run but does not yet have is downloaded into the data root first; only **once it is in place** is the plugin table written and the assembly rerun. If it cannot be downloaded, neither the plugin table nor the running Apps change.
- **Uninstall**: `DELETE` changes only the table; the next assembly no longer loads it.
- **Whole table**: `PUT` accepts only bare package names already present on this machine, for fleet sync; installation has only the one path, `POST`.
- **Versions and pinning**: `pkg@1.2.3` is recorded as the Project's requirement; the table can write `name = { version, integrity }` to pin specific content.
- **Per machine**: plugins listed only for other machines are neither downloaded nor loaded locally; the other machine does its own `POST` when the table syncs over.

## Reference-level explanation

[reference-level-explanation]: #reference-level-explanation

### Terminology

- **Plugin**: an npm package. Its identity is three things: name, version, and integrity.
- **integrity**: a fingerprint of a plugin package's content, answering "is this that package?". Defined in the next section.
- **Index**: a table of "which plugins can be installed". Each **row** gives a plugin's name, version, and integrity, plus descriptive fields such as description, license, and category.
- **Build index**: the index a build writes, listing the plugins that build publishes or carries; it lives in the bundled plugin directory's `index.json`.
- **Catalog**: the index the penguin-plugins repository publishes nightly, collecting the plugins that can be installed from the registry, third-party ones included.
- **registry**: npm's package repository (defaulting to registry.npmjs.org, honoring the machine's npm configuration).
- **prefix**: a directory holding plugins, shaped like npm's prefix: `node_modules/<name>/` contains unpacked packages, and the `.integrity` inside a package records which tarball it came from. There are three on a machine: the installation directory's, the current hot push's, and the data root's.
- **Bundled plugin directory**: the prefix a build carries with it plus the build index (the CLI package on npm has only the index). See "Channels".
- **Carry** and **list**: a row of the build index whose package is present in the bundled plugin directory means the build **carries** that plugin; present only in the index with no package in the directory means it is only **listed**.
- **Download**: fetch a plugin's tarball from the registry, verify it, and unpack it into the data root's prefix.
- **Plugin table**: the `[plugins]` table in a Project's `.project_config.toml`, recording which plugins the Project requires and at what versions; it may carry per-machine restrictions.
- **Commit point**: the rename inside a step's operation that makes the change visible to the outside world.

### Integrity

- Definition: npm's own `dist.integrity` — the tarball file uploaded to the registry, sha512 over its bytes, written as `sha512-<base64>`. What it covers is exactly the plugin package; since a plugin packages itself, this is also everything the plugin is. Anyone can verify with `npm view <name>@<version> dist.integrity`.
- **We compute it in exactly one place: at release time, over the tarball that will be uploaded.** Pack once, compute the value, upload that very file — the release command is not allowed to repack: different packing tools pick the same files (both honor `files` and `.npmignore`) yet produce different bytes. Every channel's build and release pack the same way (including the LICENSE put into the repository), so the bundled plugins' integrity matches what is on npm. Third-party plugins always use the value on the registry; it is never recomputed.
- How it is checked: before unpacking a downloaded tarball, compute sha512 over its bytes and compare with the index row; on mismatch, reject (`plugin_integrity_mismatch`), leaving nothing on the machine. A bundled plugin comes from the same build as the program, its content guaranteed by the content addressing of the installer or hot push, and it is not recomputed at runtime.
- The tarball is discarded once unpacked, so the integrity is recorded in the package directory's `.integrity`. Pinning specific content compares against exactly this; packages without `.integrity` (installed into the data root earlier with `npm install`) still load by version as before, but cannot satisfy a pin.

### Index and catalog

- Whether a plugin can be installed, and which copy, is decided by the index. Rows without integrity are listed as usual but cannot be downloaded, with the reason stated.
- The index has three sources, merged in order: the **catalog**, the **build index**, and what is already downloaded in the data root. The same content (same name, version, and integrity) is listed once, its descriptive fields taken from whichever listed it first; the same name and version with different content get one row each; yanked entries are not listed. When the catalog is unreachable (offline, timeout), the list consists of the latter two only, and it is stated which source could not be read.
- Which copy is selected: a table entry that pins an integrity takes only that copy; otherwise the highest version satisfying the requirement is taken, and within one version the copy carried by the build wins, because it needs no network.
- The plugin page shows one row per name, displaying the copy an install right now would take.
- The `plugins/index.json` inside the CLI package on npm consists of those rows of the build index that will be published to npm (private ones excluded).
- A penguin-plugins entry lives at `packages/[<@scope>/]<bucket>/<name>/<version>/<key>/`, containing `manifest.toml` and `package-lock.json`; its `integrity` is npm's `dist.integrity`. The bucket takes the first four characters of the name, split into two levels, so that even with many plugins no single directory becomes a heap of package names. Entry paths must never be moved: published content can only be yanked, never changed in place.

### Loading

- **Pick**: merge the plugin tables of all Projects (plus the parts meant only for this machine) into one requirement per name, and pick one copy of that name among the packages in the running build's prefix and the data root's prefix, following the selection rules of "Index and catalog". Version requirements recognize only the common spellings (`*`, exact versions, `^`, `~`, comparators, space-joined "and"). Plugins that cannot be picked are reported with a reason and still shown on the plugin page.
- **When**: before every assembly of plugins — first startup, hot push, after plugin-page changes — this same step runs; the data root's recovery (R) and rescue (H) run before it.
- **Import**: import from the picked package directory per its `package.json`'s `exports` or `main`. The plugin's readme is also read from the package directory.
- **Plugins depend on the host SDK**: a plugin needs `@prismshadow/penguin-core` at runtime and does not carry it in its package; it is then resolved from the running program.

### Algorithms and atomicity

**On a machine: at any moment a reader sees either the complete old state or the complete new state; before anything is deleted, another complete local copy already exists on the machine, and recovery needs no network.** The method: unpack into `.staging/` first, then move it into `node_modules/` by a rename within the same filesystem, and only then delete the old one.

Invariants:

1. `node_modules/<name>/` is never modified once placed; it is only ever replaced whole.
2. The plugin table only writes plugins already on the machine: download and place first, then write the table.
3. The data root's prefix is written only by the server; one data root has exactly one server process (`server.lock`), and the process's downloads, placements, recoveries, and rescues proceed one by one on a single queue.

**D. Download** (given the index row: name, version, integrity)

1. Create a temporary directory under `plugins/.staging/` and fetch the tarball from the registry into it with `npm pack <name>@<version>` (npm's registry, proxy, and auth configuration apply as usual). The npm used is the one on `PATH`, with the running Node's directory appended last (on Windows it is `npm.cmd`, invoked through cmd.exe, with each argument quoted individually; arguments that cannot be quoted are rejected).
2. Compute sha512 over the tarball's bytes and compare with the integrity; on mismatch, reject (`plugin_integrity_mismatch`) and delete the temporary directory.
3. Unpack into `plugins/.staging/u-<random>/package/` (dropping the tarball's top-level directory), writing `package/.integrity`. The plugin's declared dependencies are not installed.
4. Place (P), then delete the temporary directory and the tarball.

**P. Place** (given `.staging/u-…/package/` and the name)

1. `node_modules/<name>` does not exist: **rename** `u-…/package` to it; done.
2. It exists: first rename it to `.staging/d-<random>/package`, then **rename** `u-…/package` to `node_modules/<name>`.
3. Delete `d-…` and `u-…`.

**R. Recover** (before every assembly, no network)

1. `.staging/d-…/package` still exists: its `package.json` states the name; if `node_modules/<name>` does not exist (a crash between P.2's two renames), rename it back, otherwise delete it.
2. Everything else in `.staging/` (half-finished downloads, half-unpacked trees, empty directories left over after placement) is deleted.

**H. Rescue** (before every assembly): a hot push keeps only the most recent few assets; older ones get deleted. If a plugin the plugin table requires can, at this moment, only be found, in a version satisfying the requirement, inside asset directories that are **not the current one**, copy it to `plugins/.staging/u-<random>/package/` and place it into the data root per P, so that when the old asset directory is later deleted, this plugin needs no downloading either.

**L. Load**: pick each name's package directory per the "Loading" section, and import them.

What a crash at each point leaves behind:

| Crash during                      | Left on disk                                                    | Afterwards                                          |
| --------------------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| D.1–D.3, H's copy                 | a temporary directory or half-done `u-…` in `.staging/`         | R.2 deletes it; the plugin table not yet written    |
| P.1, or after P.2's second rename | the new package in place, leftovers in `.staging/`              | R.2 deletes them                                    |
| between P.2's two renames         | `node_modules/<name>` missing, the old package in `d-…/package` | R.1 renames it back; the old package loads as usual |

**Limits of the guarantee**: it protects against process crashes and kills, not power loss — there is no fsync before the renames. npm itself does not protect against this either. When the installation directory is replaced wholesale by an upgrade of the installer, the plugins inside are replaced with it; that is outside the local server's control.

#### Example: what download, replacement, recovery, and rescue look like on disk

The following is a record actually produced on a test machine (implementation `15975e793`, the parts this example touches unchanged in `c66bfee19`; the one-off script that ran it is attached to the implementation PR's description): `@acme/sandbox-x` 1.1.0 and then 1.2.0 are downloaded, a crash midway through P.2 is simulated and then recovered, and finally the rescue is demonstrated. Each package was packed with `npm pack`, and the integrity values are the real `dist.integrity` values.

Tree notation: levels that have only one subdirectory are written on the same line, and a directory's files are written in braces (`sandbox-x/{.integrity, index.js, package.json}`).

**Download 1.1.0: before P.1's rename.** The tarball in `f-…` is verified, the package is fully unpacked in `u-…/package/`, and `.integrity` is written; the destination does not yet hold this package.

```
<data-root>/plugins/
  .staging/
    f-gxL685/acme-sandbox-x-1.1.0.tgz
    u-DeLldP/package/{.integrity, index.js, package.json}
  node_modules/@acme/
```

**Download 1.2.0: before P.2's first rename.** The new package is complete in `u-…`; the old package is still in place and loads as usual.

```
<data-root>/plugins/
  .staging/
    d-hb5wlx/
    f-6lQf8t/acme-sandbox-x-1.2.0.tgz
    u-m2f1s9/package/{.integrity, index.js, package.json}
  node_modules/@acme/sandbox-x/{.integrity, index.js, package.json}
```

**Before P.2's second rename.** The old package has moved to `d-…/package/`, and the new one is still in `u-…`: at this moment `node_modules/@acme/sandbox-x` does not exist, yet both complete packages are on disk.

```
<data-root>/plugins/
  .staging/
    d-hb5wlx/package/{.integrity, index.js, package.json}
    f-6lQf8t/acme-sandbox-x-1.2.0.tgz
    u-m2f1s9/package/{.integrity, index.js, package.json}
  node_modules/@acme/
```

**After the download completes.** The new package is in place and `.staging/` is empty; the old package was deleted only after the new one was placed. The `.integrity` is `sha512-I9XMINsuCWQOUXWr+xHILZ0JzlfwxSAB36qRWV6GUjqnOvcsweJjsBl/oS/I/EotltuGkZb7P/o9kPx5Pw4TSw==`.

```
<data-root>/plugins/
  .staging/
  node_modules/@acme/sandbox-x/{.integrity, index.js, package.json}
```

**A crash between P.2's two renames, then R is run.** What the crash left behind: the destination missing, the old package in `d-…/package/`. R.1 reads its name and renames it back, with no network.

```
<data-root>/plugins/
  .staging/d-crash/package/{.integrity, index.js, package.json}
  node_modules/@acme/
```

**H: two pushes are retained, the current one being `c3d4`.** The Project requires `@acme/sandbox-y@^1`; neither the current push nor the data root has it, only the old push `a1b2` does. H copies it to `u-…/package/` and places it per P:

```
<data-root>/
  hmr/store/assets/
    a1b2/plugins/{index.json, node_modules/@acme/sandbox-y/{.integrity, index.js, package.json}}
    c3d4/plugins/{index.json, node_modules/@acme/sandbox-x/{.integrity, index.js, package.json}}
  plugins/
    .staging/
    node_modules/@acme/
      sandbox-x/{.integrity, index.js, package.json}
      sandbox-y/{.integrity, index.js, package.json}
```

Later hmr cleans up `a1b2`, and `@acme/sandbox-y` needs no downloading either.

#### Release

A release is either wholly usable, or can be resumed from where it was interrupted.

- Before publishing, the whole manifest is checked: every name to publish already exists on npm, and no published package depends on an unpublished one. Any failed check stops the whole run, and nothing is published.
- Publishing proceeds in dependency order: plugins → core → server → cli. A version already on npm is skipped, so rerunning the same version number resumes the release.
- A new name npm has never seen is published manually once by a maintainer, with authorization for automatic publishing configured; only then does it enter the automatic flow.
- The integrity in the build index is computed over the very tarball that will be uploaded, and that very file is what gets uploaded; the index inside the CLI package is written in the same release.
- Only after every npm publish has succeeded are entries added in penguin-plugins for the plugins of this release, so the catalog never points at a version not yet on npm.

### Naming and publishing

- `plugins/<dir>` is published as `@penguinharness/<dir>`, without exception.
- A plugin that is not published is marked `"private": true`: it is only carried by builds and enters neither the CLI package's index nor the catalog.
- A published package must not depend on an unpublished one; the pre-publish checks guarantee it.

### Per-channel acceptance

A channel counts as "can bring up a plugin" when all four steps hold: **arrives** (carried, or downloaded from the registry in one step), **loads** (loading succeeds and this platform's checks pass), **visible and enable-able** (the plugin page can enable it and shows its status truthfully), **actually works** (for a sandbox: one out-of-bounds command is rejected, one permitted command is allowed through). Each channel × each platform gets one fresh install that walks all four steps; the results form a matrix, re-checked at every release. The npm channel walks the full "publish → install → enable" against a local registry and does not wait for a real release.

### Relation to existing designs

- Replaces the definition of integrity in roadmap #6's proposal #11 (a self-computed sha256 over the dependency-including `package/`) and its `--install-strategy=nested` when downloading; replaces proposal #11's plugin repository and generation-switched activation directory (`plugins/<gen>/` plus a pointer): a plugin stays in the prefix it arrived in, with no copying and no separate selection file. See "Algorithms and atomicity".
- Replaces the "installation never downloads" of [design#232](https://github.com/Prism-Shadow/penguin-harness-design/pull/232) / [#913](https://github.com/Prism-Shadow/penguin-harness/pull/913).
- Keeps PRFC-0003's install location `<root>/plugins/`; the way it is written changes from `npm install` to D and P.
- Existing data: packages installed into the data root earlier with `npm install` have no `.integrity`; they still load by version as before, they just cannot satisfy a pin; the dependencies that were installed alongside them stay where they are and are no longer maintained.

## Drawbacks

[drawbacks]: #drawbacks

- A plugin must package itself. `sandbox-dsh` today declares runtime dependencies (among them `koffi` and `@deepseek-ai/node-addon-landlock-run`, which carry native parts) and must change to pack them into its own package, or it will not load once unpacked.
- One name holds one copy per prefix: once a downloaded plugin upgrades, the old version is not kept for rollback; rollback of bundled plugins is handled by the hot push retaining old assets.
- Downloading depends on the network and on the npm on `PATH`.
- The release process gains one more constraint: what is uploaded must be the very tarball the value was computed over.

## Rationale and alternatives

[rationale-and-alternatives]: #rationale-and-alternatives

- **Every distribution carries all plugins and never downloads** (design#232): the CLI package on npm would have to carry a full bundled plugin directory, and third-party plugins would still have no way in.
- **Hash the "package plus dependencies" tree, with one install rule set shared by the three places**: it can be made consistent, but verification would have to install the native parts of every platform, and no external tool can re-check that value.
- **cli carries the backends as `optionalDependencies` and recovers them from the program's dependencies**: that would reinstate "the program's own dependencies" as a fourth lookup location.
- **The server issues its own HTTP requests to download tarballs**: that would mean rewriting npm's registry access — mirrors, proxies, and auth all redone; hence the download is left to `npm pack` and the unpacking is done by the server.
- **Install the dependencies with npm**: the dependencies would have to be expanded along, and the three places' install rules aligned all over again.
- **A plugin repository plus a separate selection file** (earlier revisions of this proposal): every plugin would store one more tarball copy in the repository and unpack one more copy for loading, adding three mechanisms — repository in and out, selection switching, and reclamation — whereas bundled plugins are already kept by the installer or hot push and downloaded plugins need only one place.
- **Keep the tgz as the local source, with the unpacked directory regenerable**: that stores one more tarball copy; unpack, then rename, then delete the old already guarantees a local copy exists before any deletion.

## Prior art

[prior-art]: #prior-art

- npm: `dist.integrity` and the lock's `integrity` (SRI), generated and verified by `ssri`.
- The crates.io index: each version records the `.crate`'s sha256, with dependencies resolved separately; the bucket rule is taken from it.
- Nix / pnpm's content-addressed storage.

## Unresolved questions

[unresolved-questions]: #unresolved-questions

- **The contributions to Agents today take a second path.** core names a set of plugin packages under `dependencies`; they arrive with core's host package (a hot push carries a separate plugin library, and the host package is determined from two fixed starting points) and never pass through the three prefixes. By "one kind of plugin, one line", they too should be found from the prefixes; when to converge them, and how core's dependency on this set of packages should be handled, are undecided.
- Adding catalog entries after a release: open a PR that a person merges, or push directly; `owners`; the secret for cross-repository writes.
- penguin-plugins's tooling (entry format, checks, the nightly index) is still in [penguin-plugins#1](https://github.com/Prism-Shadow/penguin-plugins/pull/1)–[#4](https://github.com/Prism-Shadow/penguin-plugins/pull/4); `main` holds only the LICENSE.

## Future possibilities

[future-possibilities]: #future-possibilities

- npm provenance as a condition for catalog inclusion.
- Private scopes and mirror registries taking effect per npm's own configuration (`.npmrc`).

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the current version of the draft carried by design PR [#244](https://github.com/Prism-Shadow/penguin-harness-design/pull/244), identical to the source file.
