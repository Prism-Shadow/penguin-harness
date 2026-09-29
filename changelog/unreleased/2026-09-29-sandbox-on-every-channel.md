# The sandbox backends reach the Docker image and an npm global install

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `cli`, `docker`, `docs`
- **PR:** [Myriad-Dreamin/penguin-harness#98](https://github.com/Myriad-Dreamin/penguin-harness/pull/98)

[中文版](2026-09-29-sandbox-on-every-channel.zh.md)

Before this change, the builtin plugins reached a server through three channels: the CLI package's `lib/plugins`, the desktop app's `plugins/`, and a hot push. The Docker image and an npm global install of `@prismshadow/penguin-cli` now bring them too, and a fetch from the registry now runs where no npm is on `PATH`. A shipped plugin still loads only when a Project asks for it, and the sandbox mode still starts at Off.

## Docker image

- The image builds the builtin plugins prefix with the release's own `build-plugins` step, into `/opt/penguin/lib/plugins`. It is the same prefix the CLI package ships, and it serves both the amd64 and the arm64 image.
- The server looks for the installation's prefix beside the entry's real path. The image starts the program through the `/usr/local/bin/penguin` link, so the server used to look in `/usr/local/plugins`. The same resolution applies when a stored plugin borrows the host's `@prismshadow/penguin-core`.
- The Docker quickstart gains a section on running the sandbox in a container. It lists the options that let bubblewrap create user namespaces (`seccomp`, `apparmor` and `systempaths` set to `unconfined`) and describes what happens without them: the Sandbox card says the backend is not in use and why, and every mode except Off refuses every agent command.

## npm global install

- `@prismshadow/penguin-cli` declares the four sandbox backends as optional dependencies. They are private today, so npm skips them and the install still succeeds. Once they are published they install with the CLI.
- An installation without a builtin plugins prefix (no `plugins/index.json` beside its program) imports, as what it ships, the server plugins among its package's optional dependencies that npm installed: those carrying a generated `ifaces.json`. The server resolves them the way Node would from the package and stores each once per process. A workspace link in a dev checkout is not imported.

## Registry fetch

- The server runs the npm next to the Node runtime it runs on, through `node npm-cli.js`, with that Node's directory first on `PATH`. It falls back to the `npm` on `PATH` only when there is no npm next to the runtime. The CLI package's bundled runtime and the Docker image have one next to it; the desktop app's Electron does not.
- On Windows, the `PATH` fallback starts `npm.cmd` through a shell, with every argument quoted for cmd.exe. An argument that cmd.exe would expand or split is refused.
- A failed fetch reports npm's first `npm error` line. Warnings printed before it and the log pointer printed after it are skipped, and Windows line endings are handled.
- The Plugins, Skills and Server API pages no longer say that nothing is downloaded. A package the build does not ship is fetched from the registry, and a `PUT` of a name that is not on the machine answers `plugin_not_installed`.
