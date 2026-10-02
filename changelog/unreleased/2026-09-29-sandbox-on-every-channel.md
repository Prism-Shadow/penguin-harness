# The sandbox backends reach every channel, and a plugin is identified by npm's integrity

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `core`, `cli`, `docker`, `release`, `docs`
- **PR:** [Myriad-Dreamin/penguin-harness#98](https://github.com/Myriad-Dreamin/penguin-harness/pull/98)

[中文版](2026-09-29-sandbox-on-every-channel.zh.md)

Every build now carries a bundled plugin directory: the plugins it built, installed by npm, and an `index.json` listing each with its integrity. The CLI bundle, the desktop app and a hot push already did; the Docker image and a source checkout now do too. The CLI's npm package carries the index alone, and fetches a plugin from the npm registry when a Project asks for it. A plugin's integrity is npm's own `dist.integrity`. A shipped plugin still loads only when a Project asks for it, and the sandbox mode still starts at Off.

## Channels

- **Docker image.** The image builds the bundled plugin directory with the release's own `build-plugins` step, into `/opt/penguin/lib/plugins`. It is the same directory the CLI bundle ships, and it serves both the amd64 and the arm64 image. The server looks for it beside the entry's real path: the image starts the program through the `/usr/local/bin/penguin` link, so the server used to look in `/usr/local/plugins`. The Docker quickstart gains a section on running the sandbox in a container: the options that let bubblewrap create user namespaces (`seccomp`, `apparmor` and `systempaths` set to `unconfined`), and what happens without them (the Sandbox card says the backend is not in use and why, and every mode except Off refuses every agent command).
- **npm global install.** `@prismshadow/penguin-cli` carries `plugins/index.json`: the rows of this build's index for the plugins published to npm beside it. A plugin the index lists without the directory carrying it is not counted as shipped; enabling it fetches it from the registry into the plugin store.
- **Source checkout.** `pnpm build` writes the bundled plugin directory to `packages/cli/plugins/`, and the dev prestep writes it to `packages/server/plugins/` for the dev server: a source checkout runs the plugins it just built, by the CLI bundle's path. A Project's plugin table no longer loads a plugin from an absolute path; such an entry is reported as not a package name. `@prismshadow/penguin-plugin-test` stages the plugin under test as a hot push would bring it.

## Integrity

- A plugin's integrity is npm's `dist.integrity`: `sha512-` and the base64 of the sha512 of the published tarball's bytes. It covers the package, not its dependencies.
- `build-plugins` packs each plugin once and indexes that tarball's integrity; the release publishes those very tarballs.
- A registry fetch installs with npm's ordinary layout and stores the package only when the integrity npm recorded for the tarball it downloaded is the index's.
- A plugin store entry's directory is the first 16 hex digits of that sha512. A pin in a Project's plugin table, the `integrity` of `POST …/plugins/installed`, and every index entry take this form.

## Registry fetch

- The fetch runs the `npm` on `PATH`. The CLI bundle's launchers append the bundled Node runtime's directory, npm included, to the end of `PATH`: a machine without npm still fetches, and a user's own node and npm keep coming first, for the fetch and for every agent command. On Windows it starts `npm.cmd` through a shell, which Node requires for a `.cmd` file, with every argument quoted for cmd.exe; an argument that cmd.exe would expand or split is refused.
- A failed fetch reports npm's first `npm error` line. Warnings printed before it and the log pointer printed after it are skipped, and Windows line endings are handled.
- The Plugins, Skills and Server API pages no longer say that nothing is downloaded. A package the build does not ship is fetched from the registry, and a `PUT` of a name that is not on the machine answers `plugin_not_installed`.
