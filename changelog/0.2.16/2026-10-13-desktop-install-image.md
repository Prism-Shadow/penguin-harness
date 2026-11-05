# Machines: every release ships its harness, so machines installed from a desktop or tarball server work

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`, `desktop`, `ci`
- **PR:** [#1089](https://github.com/Prism-Shadow/penguin-harness/pull/1089)

[中文版](2026-10-13-desktop-install-image.zh.md)

A machine installed from the desktop app or from a tarball install that had never been hot-pushed showed as unreachable with `` no CLI pushed to <root>; use `penguin` instead ``. Every command the server runs on a machine goes through the CLI in that machine's hmr store, and such a server installed only the bare release, which leaves the store empty. Release builds now ship the release's harness in the hot push's format, and the server installs it, so the three install kinds (desktop, tarball, source checkout) all put a release plus a store with a CLI on the machine. The macOS desktop app also refused every install with `409 no_install_image`, because the server matched the app's `Contents/Resources` directory against a lowercase `resources`; the name is now compared without regard to case.

## Details

- The release workflow writes `lib/dist/install-image.gz` into the tarball payloads, and every desktop pack writes `dist/install-image.gz` into the app (a new `image` script, run by the `pack*` scripts, CI's runtime job and `desktop-build.yml`). The file is the upgrade body `scripts/deploy.mjs --out` produces, built from the release's own sources.
- A server that was never pushed to lays that body down once, in the store format a push leaves, under `<root>/machines/release-image/<id>/`, at boot or at the first install that needs it. Its install plan is the release plus that store, and its version gains the `+hmr.<sha>` suffix. A server that was pushed to keeps installing its pushed state.
- A machine carrying the right release with an empty store now gets the store replicated directly, with no installer run. It is no longer sent to the update channel, which nothing there can answer. Running Update or Force install from the Machines page therefore repairs machines installed before this change.
- When a machine's `penguin-hmr` reports that its store holds no CLI, the Machines page says the machine needs this build installed again from the page, followed by the machine's own words.
- An image built from a stamped release records that release (`v<version>`) as its revision, so a machine whose release server answers beside it is read as running it rather than as a release that fell back.
- `desktop-build.yml` stamps `BUILD_COMMIT` the way `release.yml` does, so the desktop's image and the tarballs' image are compiled from the same source.
- `verify-packed-cli.mjs` also checks the packed app for `dist/server.js`, the installers beside it, `dist/install-image.gz` and the version in its `package.json`. The desktop build copies the installers from the list the server build and the hot push share.
